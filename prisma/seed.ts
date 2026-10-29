/* FirstLight — pilot seed script.
 *
 * Creates the pilot organization, one user per role (with DEMO login tokens
 * printed + stored as SHA-256 hashes — see SECURITY.md for why this is a
 * pilot mechanism, not a production one), and one demo event. Idempotent:
 * re-running skips existing rows.
 *
 *   DATABASE_URL=file:$(pwd)/db/firstlight.db bunx prisma db push
 *   DATABASE_URL=… bun run db:seed
 */

import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const db = new PrismaClient();

const USERS = [
  {
    email: 'admin@firstlight.example',
    name: 'Asha Mwangi (Admin)',
    role: 'admin',
    token: 'fl-demo-admin-token-2026',
  },
  {
    email: 'analyst@firstlight.example',
    name: 'Dana Okafor (Analyst)',
    role: 'analyst',
    token: 'fl-demo-analyst-token-2026',
  },
  {
    email: 'reviewer@firstlight.example',
    name: 'Miriam Haddad (Reviewer)',
    role: 'reviewer',
    token: 'fl-demo-reviewer-token-2026',
  },
  {
    email: 'approver@firstlight.example',
    name: 'Jonas Weber (Approver)',
    role: 'approver',
    token: 'fl-demo-approver-token-2026',
  },
  {
    email: 'observer@firstlight.example',
    name: 'Lin Wei (Observer)',
    role: 'observer',
    token: 'fl-demo-observer-token-2026',
  },
] as const;

async function main() {
  const org = (await db.organization.upsert({
    where: { slug: 'firstlight-pilot' },
    create: { slug: 'firstlight-pilot', name: 'FirstLight Open-Data Pilot' },
    update: { name: 'FirstLight Open-Data Pilot' },
  }))!;

  for (const u of USERS) {
    await db.user.upsert({
      where: { email: u.email },
      create: {
        orgId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tokenHash: sha256(u.token),
      },
      update: { role: u.role, tokenHash: sha256(u.token) },
    });
  }

  const existingEvent = await db.incidentEvent.findFirst({
    where: { orgId: org.id, name: 'Cedar River Flood (Pilot)' },
  });
  if (!existingEvent) {
    await db.incidentEvent.create({
      data: {
        orgId: org.id,
        name: 'Cedar River Flood (Pilot)',
        archetype: 'flood',
        status: 'draft',
        country: 'United States',
        location: 'Cedar Rapids, Iowa',
        centerLat: 41.977,
        centerLng: -91.665,
        aoiKm: 9,
        incidentTime: new Date('2025-06-16T12:00:00Z'),
        severity: 0.74,
        seed: 20250616,
        demoLayer: true,
        createdBy: (await db.user.findUnique({ where: { email: USERS[1].email } }))!.id,
      },
    });
  }

  console.log('Seeded organization:', org.name);
  console.log('\nDemo login accounts (PILOT ONLY — rotate before any real use):');
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(9)} ${u.email.padEnd(32)} token: ${u.token}`);
  }
  console.log('\nLogin: POST /api/auth/login {"email":"…","token":"…"}');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
