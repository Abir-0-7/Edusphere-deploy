import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const devHosts = ['localhost', '127.0.0.1'];

function parseProductionOrigin(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid extension origin: ${value}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Production origins must be exact HTTPS origins without a path: ${value}`);
  }
  return url.origin;
}

function patternForOrigin(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}/*`;
}

const productionOrigins = [...new Set(
  (process.env.EXTENSION_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseProductionOrigin),
)];
const developmentHosts = productionOrigins.length === 0 ? devHosts : [];
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
manifest.externally_connectable.matches = [
  ...developmentHosts.map((host) => `http://${host}/*`),
  ...productionOrigins.map(patternForOrigin),
];

await mkdir(output, { recursive: true });
await cp(path.join(root, 'src'), path.join(output, 'src'), { recursive: true });
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(output, 'src', 'origin-config.js'),
  `export const ORIGIN_CONFIG = Object.freeze(${JSON.stringify({ exactOrigins: productionOrigins, developmentHosts }, null, 2)});\n\nexport function isAllowedWebOrigin(senderUrl, config = ORIGIN_CONFIG) {\n  if (typeof senderUrl !== 'string') return false;\n  let url;\n  try { url = new URL(senderUrl); } catch { return false; }\n  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return false;\n  if (config.exactOrigins.includes(url.origin)) return true;\n  return url.protocol === 'http:' && config.developmentHosts.includes(url.hostname);\n}\n`,
);
console.log(`Built extension at ${output}`);
