import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { syncSystemPrompt } from './sync-system-prompt.mjs';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const prepBlob = path.join(root, 'vibes-browser.blob');
const outputBinary = path.join(distDir, 'vibes-browser');
const bundledEntrypoint = path.join(distDir, 'sea-entry.cjs');

fs.mkdirSync(distDir, { recursive: true });
await syncSystemPrompt(root);

await build({
  entryPoints: [path.join(root, 'src', 'cli.mjs')],
  outfile: bundledEntrypoint,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'bundle',
});

const seaConfig = {
  main: './dist/sea-entry.cjs',
  output: './vibes-browser.blob',
  disableExperimentalSEAWarning: true,
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibes-browser-sea-'));
const seaConfigPath = path.join(tempDir, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

try {
  run(process.execPath, [`--experimental-sea-config=${seaConfigPath}`], root);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

fs.rmSync(outputBinary, { force: true });
fs.copyFileSync(process.execPath, outputBinary);
fs.chmodSync(outputBinary, 0o755);

const postjectBin = path.join(
  root,
  'node_modules',
  '.bin',
  os.platform() === 'win32' ? 'postject.cmd' : 'postject',
);
run(
  postjectBin,
  [
    outputBinary,
    'NODE_SEA_BLOB',
    prepBlob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  root,
);

fs.chmodSync(outputBinary, 0o755);
console.log(`SEA binary written to ${outputBinary}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
