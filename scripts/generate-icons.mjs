/** Rebuild icons from the repository's vector brand: node scripts/generate-icons.mjs */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const original = await readFile(new URL('public/favicon.svg', root), 'utf8');
// Native launchers provide their own corner mask. Opaque full-bleed background
// avoids a second rounded rectangle or black transparent corners on iOS.
const square = original.replace(' rx="12"', '');
const maskable = square.replace(
  '<path ',
  '<path transform="translate(2 2) scale(.9)" ',
);
const outputs = [
  ['public/icons/icon-192.png', 192, square],
  ['public/icons/icon-512.png', 512, square],
  ['public/icons/apple-touch-icon.png', 180, square],
  ['public/icons/maskable-512.png', 512, maskable],
  ['assets/icon-only.png', 1024, square],
];
for (const [path, size, svg] of outputs) {
  const destination = new URL(path, root);
  await mkdir(new URL('.', destination), { recursive: true });
  const bytes = await sharp(Buffer.from(svg))
    .resize(size, size)
    .flatten({ background: '#102c37' })
    .removeAlpha()
    .png()
    .toBuffer();
  await writeFile(destination, bytes);
  console.log(
    `${fileURLToPath(destination)}: ${size}×${size}, ${bytes.length} bytes`,
  );
}

// Optional native outputs: run again after `cap add ios` / `cap add android`.
const { access, readdir } = await import('node:fs/promises');
const exists = async (path) => {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
};
const save = async (path, bytes) => {
  await mkdir(new URL('.', new URL(path, root)), { recursive: true });
  await writeFile(new URL(path, root), bytes);
};
const foreground = original
  .replace(/<rect[^>]*\/>/, '')
  .replace('<path ', '<path transform="translate(5.6 5.6) scale(.72)" ');
const android = 'android/app/src/main/res/';
if (await exists(android)) {
  for (const [density, size, foregroundSize] of [
    ['mdpi', 48, 108],
    ['hdpi', 72, 162],
    ['xhdpi', 96, 216],
    ['xxhdpi', 144, 324],
    ['xxxhdpi', 192, 432],
  ]) {
    const icon = await sharp(Buffer.from(square))
      .resize(size, size)
      .png()
      .toBuffer();
    await save(`${android}mipmap-${density}/ic_launcher.png`, icon);
    const circle = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
    );
    await save(
      `${android}mipmap-${density}/ic_launcher_round.png`,
      await sharp(icon)
        .composite([{ input: circle, blend: 'dest-in' }])
        .png()
        .toBuffer(),
    );
    await save(
      `${android}mipmap-${density}/ic_launcher_foreground.png`,
      await sharp(Buffer.from(foreground))
        .resize(foregroundSize, foregroundSize)
        .png()
        .toBuffer(),
    );
  }
  const adaptive =
    '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
  await save(`${android}mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  await save(`${android}mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
  await save(
    `${android}values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#102c37</color></resources>\n',
  );
  await save(
    `${android}drawable/ic_launcher_background.xml`,
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#102c37"/></shape>\n',
  );
  await save(
    `${android}drawable-v24/ic_launcher_foreground.xml`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="40" android:viewportHeight="40"><group android:pivotX="20" android:pivotY="20" android:scaleX="0.72" android:scaleY="0.72"><path android:fillColor="#65d7bd" android:pathData="M11,18 L30,9 L21,31 L18,20 Z"/></group></vector>\n',
  );
  // A neutral launch canvas replaces all stock Capacitor splash logos.
  for (const directory of await readdir(new URL(android, root))) {
    const path = `${android}${directory}/splash.png`;
    if (await exists(path)) {
      const { width, height } = await sharp(
        new URL(path, root).pathname,
      ).metadata();
      await save(
        path,
        await sharp({
          create: { width, height, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer(),
      );
    }
  }
  console.log(
    'Android launcher icons, adaptive resources and neutral splash images generated.',
  );
}
const ios = 'ios/App/App/Assets.xcassets/';
if (await exists(ios)) {
  await save(
    `${ios}AppIcon.appiconset/AppIcon-512@2x.png`,
    await readFile(new URL('assets/icon-only.png', root)),
  );
  for (const file of await readdir(new URL(`${ios}Splash.imageset/`, root))) {
    if (!file.endsWith('.png')) continue;
    const path = `${ios}Splash.imageset/${file}`;
    const { width, height } = await sharp(
      new URL(path, root).pathname,
    ).metadata();
    await save(
      path,
      await sharp({
        create: { width, height, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer(),
    );
  }
  console.log('iOS opaque1024 icon and neutral splash images generated.');
}
