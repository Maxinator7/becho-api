import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

// No 0/O or 1/I/L, so codes can be read out over the phone without confusion.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateUserCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `BCH-${code}`;
}

/** A user code not yet taken (31^6 ≈ 887M combinations, so retries are practically never needed). */
export async function uniqueUserCode(tx: Prisma.TransactionClient = prisma) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateUserCode();
    if (!(await tx.user.findUnique({ where: { userCode: code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate a unique user code');
}

export const USER_CODE_PATTERN = /^BCH-[0-9A-Z]{6}$/;
