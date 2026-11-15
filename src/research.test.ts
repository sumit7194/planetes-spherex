/**
 * The detectors page draws its charts from public/research/v4 (served copies). They must stay
 * byte-identical to the published evidence in research/v4, whose sha256 are in its PROVENANCE.md.
 */
import { describe, expect, it } from 'vitest';

// Node's modules, loaded without Node's types (they would leak into the app's own type check).
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as {
  readFileSync(p: string, enc?: string): Uint8Array & { toString(): string };
};
const crypto = (await import(/* @vite-ignore */ `node:${'crypto'}`)) as {
  createHash(a: string): { update(b: Uint8Array): { digest(e: string): string } };
};

const files = [
  'results/realism_v_pool.json',
  'results/thresholds.json',
  'results/v_look_result_public.json',
  'PROVENANCE.md',
];
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

describe('served research copies', () => {
  it.each(files)('%s is byte-identical to research/v4', (f) => {
    expect(sha(`public/research/v4/${f}`)).toBe(sha(`research/v4/${f}`));
  });
  it('the results match their PROVENANCE sha256', () => {
    const prov = fs.readFileSync('research/v4/PROVENANCE.md', 'utf8').toString();
    for (const f of files.slice(0, 3)) expect(prov).toContain(`${sha(`research/v4/${f}`)}  ./${f}`);
  });
});
