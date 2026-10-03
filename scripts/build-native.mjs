import { spawnSync } from 'node:child_process';

// Native assets must use the local root, independently of a web deployment path.
// A distinct directory prevents cap sync from copying a web/PWA build by mistake.
const env = { ...process.env, BASE_PATH: '/', VITE_NATIVE: '1' };
const build = spawnSync(
  'npm',
  ['run', 'build', '--', '--outDir', 'dist-native', '--emptyOutDir'],
  {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
