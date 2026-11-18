/**
 * Tidy a staging database before inviting beta reviewers.
 *
 *   DATABASE_URL='<connection string>' npm run beta:prepare            # dry run: shows what would change
 *   DATABASE_URL='<connection string>' npm run beta:prepare -- --apply # make the changes
 *
 * 1. Deletes automated test accounts (and everything they own: listings, chats, offers…):
 *    deploy-check@example.com, live-check-*@example.com, design-test-*@example.com,
 *    design-mobile-test-*@example.com, design-admin-test-*@example.com, ui-test-*@example.com,
 *    admin-ui-test-*@example.com, stagetest*@example.com.
 * 2. Clears "mobile verified" on every account: no SMS verification exists yet, so any earlier
 *    value came from an on-screen test code and would mislead reviewers.
 * Pass extra emails to delete with --delete=a@x.com,b@y.com
 */
import { PrismaClient, Prisma } from '@prisma/client';

const TEST_PATTERNS: Prisma.UserWhereInput[] = [
  { email: 'deploy-check@example.com' },
  { email: { startsWith: 'live-check-', endsWith: '@example.com' } },
  { email: { startsWith: 'design-test-', endsWith: '@example.com' } },
  { email: { startsWith: 'design-mobile-test-', endsWith: '@example.com' } },
  { email: { startsWith: 'design-admin-test-', endsWith: '@example.com' } },
  { email: { startsWith: 'ui-test-', endsWith: '@example.com' } },
  { email: { startsWith: 'admin-ui-test-', endsWith: '@example.com' } },
  { email: { startsWith: 'stagetest', endsWith: '@example.com' } },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const extra = (process.argv.find((a) => a.startsWith('--delete='))?.slice('--delete='.length) ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    console.log(`Database: ${new URL(process.env.DATABASE_URL).host}${apply ? '' : '   (dry run — add --apply to make changes)'}\n`);

    const where: Prisma.UserWhereInput = { OR: [...TEST_PATTERNS, ...extra.map((email) => ({ email }))], role: 'USER' };
    const testUsers = await prisma.user.findMany({
      where,
      select: { id: true, email: true, userCode: true, _count: { select: { listings: true } } },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`Test accounts to delete: ${testUsers.length}`);
    for (const u of testUsers) console.log(`  - ${u.email} (${u.userCode}), ${u._count.listings} listing(s)`);

    const phoneVerified = await prisma.user.count({ where: { phoneVerifiedAt: { not: null } } });
    console.log(`\nAccounts showing "mobile verified" without real SMS verification: ${phoneVerified}`);

    if (!apply) {
      console.log('\nNothing changed. Re-run with --apply to delete the accounts above and clear the mobile-verified flags.');
      return;
    }
    const ids = testUsers.map((u) => u.id);
    // Chats/offers reference both sides; remove those first so cascades don't trip over foreign keys.
    await prisma.$transaction([
      prisma.offer.deleteMany({ where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] } }),
      prisma.conversation.deleteMany({ where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
      prisma.user.updateMany({ where: { phoneVerifiedAt: { not: null } }, data: { phoneVerifiedAt: null } }),
    ]);
    console.log(`\n✅ Deleted ${ids.length} test account(s) and cleared ${phoneVerified} mobile-verified flag(s).`);
    console.log('Uploaded photos of deleted listings stay in R2 until removed there; they are no longer linked anywhere.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
