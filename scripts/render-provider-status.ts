/* render-provider-status.ts — single source of truth → generated outputs.
 *
 * Reads src/lib/firstlight/provider-status.json and writes:
 *   1. docs/PROVIDER_STATUS.md      (full registry, human-readable)
 *   2. README.md provider table     (replaces the BEGIN/END marker block)
 *
 * Run: bun run scripts/render-provider-status.ts
 * Never hand-edit generated sections.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'src/lib/firstlight/provider-status.json');
const MD = join(ROOT, 'docs/PROVIDER_STATUS.md');
const README = join(ROOT, 'README.md');

interface Provider {
  id: string;
  provider: string;
  dataset: string;
  pilotStatus: string;
  publicDemo: string;
  dataRole: string;
  license: string;
  attribution: string;
  verifiedInRepo: string;
  notes: string;
}

interface Candidate {
  id: string;
  provider: string;
  dataset: string;
  status: string;
  researchedTerms: string;
  whyValuable: string;
  ownerNextAction: string;
}

const data = JSON.parse(readFileSync(SRC, 'utf8')) as {
  lastVerified: string;
  implemented: Provider[];
  candidates: Candidate[];
  deployedServiceStatus: { publicOperationalDeployment: boolean; statement: string };
};

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const implRows = data.implemented
  .map(
    (p) =>
      `| ${esc(p.provider)} | ${esc(p.dataset)} | ${esc(p.pilotStatus)} | ${esc(p.publicDemo)} | ${esc(p.dataRole)} | ${esc(p.license)} |`,
  )
  .join('\n');

const candRows = data.candidates
  .map(
    (p) =>
      `| ${esc(p.provider)} | ${esc(p.dataset)} | ${esc(p.status)} | ${esc(p.researchedTerms)} | ${esc(p.ownerNextAction)} |`,
  )
  .join('\n');

const md = `# Provider & source registry

> **Generated file** — from \`src/lib/firstlight/provider-status.json\` via \`bun run scripts/render-provider-status.ts\`. Do not hand-edit.
> Status vocabulary: live (adapter implemented, test-exercised) · blocked (credentials absent) · fixtures-only · catalog-only · candidate (research lead, access NOT verified) · not connected.
> A catalog listing is **not** an acquisition; a downloaded asset is **not** a processed product; no provider supplies a processed product to this project.
> **Deployment status:** ${data.deployedServiceStatus.statement}

## Implemented adapters (local pilot)

_Last verified ${data.lastVerified} — statuses reflect code + tests in this repository, not the desired roadmap._

| Provider | Dataset | Pilot status | Public demo | Data role (honest) | License |
|---|---|---|---|---|---|
${implRows}

## Researched candidates (NOT connected — access/terms not verified)

| Provider | Dataset | Status | Terms researched | Next owner action |
|---|---|---|---|---|
${candRows}
`;

writeFileSync(MD, md);

const table = `<!-- BEGIN:PROVIDER_TABLE -->
| Provider | Pilot status | Public demo | Data role (honest) |
|---|---|---|---|
${data.implemented
  .map(
    (p) =>
      `| ${esc(p.provider)} | ${esc(p.pilotStatus)} | ${esc(p.publicDemo)} | ${esc(p.dataRole)} |`,
  )
  .join('\n')}
${data.candidates
  .map(
    (p) => `| ${esc(p.provider)} | ${esc(p.status)} | not connected | ${esc(p.whyValuable)} |`,
  )
  .join('\n')}

Full terms, attribution, evidence, and next owner actions: \`docs/PROVIDER_STATUS.md\` (generated, verified ${data.lastVerified}).
<!-- END:PROVIDER_TABLE -->`;

const readme = readFileSync(README, 'utf8');
const marker = /<!-- BEGIN:PROVIDER_TABLE -->[\s\S]*?<!-- END:PROVIDER_TABLE -->/;
if (!marker.test(readme)) {
  console.error('README provider-table markers not found — aborting');
  process.exit(1);
}
writeFileSync(README, readme.replace(marker, table));

console.log(`wrote docs/PROVIDER_STATUS.md (${data.implemented.length} implemented, ${data.candidates.length} candidates)`);
console.log('README provider table updated');
