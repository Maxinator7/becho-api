/**
 * Set a new password for an existing account (e.g. a forgotten admin password).
 *
 *   DATABASE_URL='<connection string>' npm run user:set-password -- admin@becho.in
 *
 * The password is typed at a hidden prompt (never echoed or saved in shell history).
 * All of the user's existing sessions are signed out.
 */
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/** One readline for all prompts; typed characters are not echoed while `muted`. */
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false });
  const internals = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  internals._writeToOutput = (s: string) => {
    if (!muted) internals.output.write(s);
  };
  // Async iterator buffers lines, so nothing is lost if input arrives before we ask.
  const lines = rl[Symbol.asyncIterator]();
  return {
    async askHidden(question: string): Promise<string> {
      process.stdout.write(question);
      muted = true;
      const next = await lines.next();
      muted = false;
      process.stdout.write('\n');
      return next.done ? '' : String(next.value);
    },
    close: () => rl.close(),
  };
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run user:set-password -- <email>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, displayName: true, role: true } });
    if (!user) {
      console.error(`No account with email ${email}.`);
      process.exit(1);
    }
    const host = new URL(process.env.DATABASE_URL).host;
    console.log(`Account: ${user.displayName} (${user.role}) on ${host}`);

    const prompt = createPrompter();
    const password = await prompt.askHidden('New password (min 8 characters): ');
    if (password.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(1);
    }
    const confirm = await prompt.askHidden('Repeat new password: ');
    prompt.close();
    if (confirm !== password) {
      console.error('Passwords do not match. Nothing was changed.');
      process.exit(1);
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { actorId: user.id, action: 'PASSWORD_RESET_CLI', targetType: 'USER', targetId: user.id } }),
    ]);
    console.log('✅ Password updated. Existing sessions for this account were signed out.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
