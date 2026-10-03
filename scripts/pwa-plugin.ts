import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { serviceWorkerSource, type PwaAsset } from './pwa-worker';
const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export function brisaPwa(): Plugin {
  let config: ResolvedConfig;
  let enabled = false;
  return {
    name: 'brisa-pwa',
    apply: 'build',
    configResolved(value) {
      config = value;
      enabled =
        process.env.VITE_NATIVE !== '1' && value.env.VITE_NATIVE !== '1';
    },
    transformIndexHtml(html) {
      if (!enabled) return html;
      return {
        html,
        tags: [
          {
            tag: 'link',
            attrs: {
              rel: 'manifest',
              href: `${config.base}manifest.webmanifest`,
            },
            injectTo: 'head',
          },
        ],
      };
    },
    async closeBundle() {
      if (!enabled) return;
      const base = config.base;
      if (
        !base.startsWith('/') ||
        !base.endsWith('/') ||
        base.includes('?') ||
        base.includes('#')
      )
        throw new Error('PWA requires a root-relative BASE_PATH ending in /.');
      const out = path.resolve(config.root, config.build.outDir);
      const manifest = {
        id: base,
        name: 'Brisa walking planner',
        short_name: 'Brisa',
        description: 'Walking routes with historical report context.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#102c37',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      };
      await writeFile(
        path.join(out, 'manifest.webmanifest'),
        JSON.stringify(manifest),
      );
      const walk = async (dir: string): Promise<string[]> => {
        const entries = await readdir(path.join(out, dir), {
          withFileTypes: true,
        });
        return (
          await Promise.all(
            entries.map((entry) =>
              entry.isDirectory()
                ? walk(path.posix.join(dir, entry.name))
                : [path.posix.join(dir, entry.name)],
            ),
          )
        ).flat();
      };
      const files = await walk('');
      const catalog = JSON.parse(
        await readFile(path.join(out, 'data/catalog.json'), 'utf8'),
      ) as { areas: { datasetUrl: string }[] };
      const cityFiles = new Set(
        catalog.areas.map((area) => area.datasetUrl.replace(/^\//, '')),
      );
      const core: PwaAsset[] = [],
        cities: PwaAsset[] = [];
      for (const file of files.sort()) {
        const city = cityFiles.has(file);
        if (
          !city &&
          !(
            file === 'index.html' ||
            file === 'manifest.webmanifest' ||
            file === 'favicon.svg' ||
            file === 'data/catalog.json' ||
            file.startsWith('assets/') ||
            file.startsWith('fonts/') ||
            file.startsWith('icons/')
          )
        )
          continue;
        if (file.endsWith('.map')) continue;
        const bytes = await readFile(path.join(out, file));
        const asset = {
          path: base + file,
          sha256: hash(
            city ? JSON.stringify(JSON.parse(bytes.toString('utf8'))) : bytes,
          ),
          ...(city ? { json: true } : {}),
        };
        (city ? cities : core).push(asset);
      }
      const revision = hash(JSON.stringify({ base, core, cities })).slice(
        0,
        20,
      );
      await writeFile(
        path.join(out, 'sw.js'),
        serviceWorkerSource(base, revision, core, cities),
      );
    },
  };
}
