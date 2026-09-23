import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(repositoryRoot, 'scripts/operations.manifest.json');
const scannedRoots = ['scripts', 'server/src/scripts'];
const operationalExtensions = new Set(['.sh', '.py', '.mjs', '.ts']);
const allowedStatuses = new Set(['supported', 'compatibility']);

function toRepositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectFiles(path));
    } else if (operationalExtensions.has(extension(entry))) {
      files.push(toRepositoryPath(path));
    }
  }
  return files;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.scripts)) {
  throw new Error('Unsupported or malformed operations manifest');
}

const errors = [];
const manifestPaths = new Set();

for (const entry of manifest.scripts) {
  const requiredTextFields = ['path', 'owner', 'purpose', 'invocation', 'safety'];
  for (const field of requiredTextFields) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      errors.push(`${entry.path ?? '<unknown>'}: missing ${field}`);
    }
  }
  if (!allowedStatuses.has(entry.status)) {
    errors.push(`${entry.path ?? '<unknown>'}: invalid status '${entry.status}'`);
  }
  if (manifestPaths.has(entry.path)) {
    errors.push(`${entry.path}: duplicate manifest entry`);
  }
  manifestPaths.add(entry.path);
  if (!existsSync(resolve(repositoryRoot, entry.path))) {
    errors.push(`${entry.path}: manifest entry points to a missing file`);
  }
}

const discoveredPaths = scannedRoots
  .flatMap((root) => collectFiles(resolve(repositoryRoot, root)))
  .sort();

for (const path of discoveredPaths) {
  if (!manifestPaths.has(path)) errors.push(`${path}: not classified in operations manifest`);
}
for (const path of manifestPaths) {
  if (!discoveredPaths.includes(path)) errors.push(`${path}: classified but outside the scanned script inventory`);
}

if (errors.length > 0) {
  console.error('Operations inventory validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const counts = Object.fromEntries(
  [...allowedStatuses].map((status) => [
    status,
    manifest.scripts.filter((entry) => entry.status === status).length,
  ]),
);

console.log(
  `Operations inventory valid: ${manifest.scripts.length} scripts `
    + `(${counts.supported} supported, ${counts.compatibility} compatibility).`,
);
