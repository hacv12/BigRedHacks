import { spawn, spawnSync } from 'node:child_process';

const vite = 'node_modules/vite/bin/vite.js';
const base = '/pwa-test/';
const port = '4175';
const directory = 'dist-pwa-test';
const url = `http://127.0.0.1:${port}${base}`;
const env = { ...process.env, BASE_PATH: base, VITE_NATIVE: '0' };
const build = spawnSync(
  process.execPath,
  [vite, 'build', '--base', base, '--outDir', directory, '--emptyOutDir'],
  { stdio: 'inherit', env },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const server = spawn(
  process.execPath,
  [
    vite,
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--strictPort',
    '--base',
    base,
    '--outDir',
    directory,
  ],
  { stdio: 'inherit', env },
);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error('PWA preview could not start.');
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local server. */
    }
  }
  if (!ready) throw new Error('PWA preview did not become ready.');
  const smoke = spawn(process.execPath, ['scripts/pwa-smoke.mjs'], {
    stdio: 'inherit',
    env: { ...env, PWA_TEST_URL: url },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    smoke.once('error', reject);
    smoke.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  server.kill('SIGTERM');
}
