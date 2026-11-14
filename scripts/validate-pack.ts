/**
 * Validates a pack directory against schema/pack.schema.json, then checks what a schema can't:
 * every tile file exists with the right size, and every stack refers to real frames.
 *
 *   npm run validate:pack -- <pack dir>
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

interface Tile {
  id: string;
  image: string;
  flags: string;
}
interface Manifest {
  grid: { size: number };
  generator: { commit: string };
  frames: Tile[];
  stacks: (Tile & { frameIds: string[] })[];
  measurements: string;
}

const dir = resolve(process.argv[2] ?? '');
const schema = JSON.parse(
  readFileSync(new URL('../schema/pack.schema.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats.default(ajv);
ajv.addSchema(schema, 'pack');

const problems: string[] = [];
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(dir, path), 'utf8'));

const manifest = readJson('manifest.json') as Manifest;
if (!ajv.validate('pack', manifest)) {
  for (const e of ajv.errors ?? []) problems.push(`manifest${e.instancePath}: ${e.message}`);
}

// A pack must come from a committed generator: "+dirty", a short hash or an empty commit means
// its numbers can't be traced back to code anyone can read.
if (!/^[0-9a-f]{40}$/.test(manifest.generator.commit))
  problems.push(
    `generator: commit "${manifest.generator.commit}" is not a clean, full commit hash`,
  );

const measurements = readJson(manifest.measurements);
const checkMeasurement = ajv.compile({ $ref: 'pack#/$defs/measurement' });
if (!Array.isArray(measurements)) problems.push('measurements: expected an array');
else
  measurements.forEach((m, i) => {
    if (!checkMeasurement(m)) {
      for (const e of checkMeasurement.errors ?? [])
        problems.push(`measurements[${i}]${e.instancePath}: ${e.message}`);
    }
  });

const n = manifest.grid.size * manifest.grid.size;
const checkFile = (path: string, bytes: number, what: string) => {
  const full = join(dir, path);
  if (!existsSync(full)) problems.push(`${what}: missing ${path}`);
  else if (statSync(full).size !== bytes)
    problems.push(`${what}: ${path} is ${statSync(full).size} bytes, expected ${bytes}`);
};
const frameIds = new Set(manifest.frames.map((f) => f.id));
for (const t of [...manifest.frames, ...manifest.stacks]) {
  checkFile(t.image, n * 4, t.id);
  checkFile(t.flags, n, t.id);
}
for (const s of manifest.stacks) {
  const missing = s.frameIds.filter((id) => !frameIds.has(id));
  if (missing.length) problems.push(`stack ${s.id}: ${missing.length} unknown frame ids`);
}

if (problems.length) {
  console.error(`✗ ${dir}\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `✓ ${dir}: ${manifest.frames.length} frames, ${manifest.stacks.length} stacks, ${Array.isArray(measurements) ? measurements.length : 0} measurements`,
);
