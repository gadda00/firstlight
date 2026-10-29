/* Regenerate tests/fixtures/golden-digests.json.
 * Run deliberately (never silently in CI):
 *   bun run tests/make-golden.ts
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';

const out: Record<string, string> = {};
for (const meta of EVENTS) {
  const raw = generateEvent(meta);
  out[meta.id] = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  console.log(`${meta.id}: ${out[meta.id]}`);
}
writeFileSync(
  new URL('./fixtures/golden-digests.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log('written: tests/fixtures/golden-digests.json');
