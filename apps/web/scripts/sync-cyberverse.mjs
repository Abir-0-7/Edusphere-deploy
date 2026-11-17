import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

// Deliberately opt-in: production builds use the checked-in export, not a sibling repository.
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv[2] || path.join(webRoot, '../../../cyberverse/build/web'));
const destination = path.join(webRoot, 'public/games/cyberverse');
const files = ['index.html', 'index.js', 'index.wasm', 'index.pck', 'index.icon.png',
  'index.apple-touch-icon.png', 'index.png', 'index.audio.worklet.js',
  'index.audio.position.worklet.js', 'edusphere_bridge.js'];
await mkdir(destination, { recursive: true });
const html = await readFile(path.join(source, 'index.html'), 'utf8');
if (!html.includes('edusphere_bridge.js')) {
  throw new Error('Export is stale: index.html must load edusphere_bridge.js. Re-export with the current Web preset first.');
}
const manifest = {};
for (const name of files) {
  const contents = await readFile(path.join(source, name));
  await copyFile(path.join(source, name), path.join(destination, name));
  manifest[name] = { bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
}
await writeFile(path.join(destination, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Synced ${files.length} CYBERVERSE Web files to ${destination}\n`);
