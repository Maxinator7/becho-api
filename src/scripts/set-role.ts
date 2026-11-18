/**
 * Give an account a staff role (or take it away), e.g. to let beta reviewers into the admin portal.
 *
 *   DATABASE_URL='<connection string>' npm run user:set-role -- reviewer@example.com MODERATOR
 *   DATABASE_URL='<connection string>' npm run user:set-role -- BCH-7K3M9Q USER
 *
 * MODERATOR can review listings, users and feedback; only ADMIN can suspend/ban users or change cities.
 * The user must sign in again for the new role to apply. Signs out their existing sessions.
 */
import { PrismaClient } from '@prisma/client';

const ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;

async function main() {
  const [who, roleArg] = process.argv.slice(2);
  const role = roleArg?.toUpperCase() as (typeof ROLES)[number];
  if (!who || !ROLES.includes(role)) {
    console.error('Usage: npm run user:set-role -- <email | user code> <USER | MODERATOR | ADMIN>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const where = who.includes('@') ? { email: who.trim().toLowerCase() } : { userCode: who.trim().toUpperCase() };
    const user = await prisma.user.findUnique({ where, select: { id: true, displayName: true, role: true, status: true } });
    if (!user) {
      console.error(`No account found for ${who}. Ask them to register on the website first.`);
      process.exit(1);
    }
    console.log(`Database: ${new URL(process.env.DATABASE_URL).host}`);
    console.log(`Account:  ${user.displayName} — currently ${user.role}, ${user.status}`);
    if (user.role === role) {
      console.log(`Already ${role}; nothing to change.`);
      return;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { role } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { actorId: user.id, action: 'ROLE_CHANGED_CLI', targetType: 'USER', targetId: user.id, details: { from: user.role, to: role } } }),
    ]);
    console.log(`✅ ${user.displayName} is now ${role}. They need to sign in again.`);
    if (user.status !== 'ACTIVE') console.log(`⚠️  Their account is ${user.status}; they must verify their email before they can sign in to the admin portal.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
