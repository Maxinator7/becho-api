/**
 * Demo listings with photos across cities, so beta reviewers don't land on an empty marketplace.
 * Everything is clearly marked as demo (seller names end in "(Demo)", descriptions say so, metadata.demo = true).
 *
 *   DATABASE_URL='<connection string>' npm run seed:demo             # add (safe to re-run)
 *   DATABASE_URL='<connection string>' npm run seed:demo -- --remove # delete all demo sellers + their listings
 *
 * Demo sellers can't sign in (random password), so offers on demo listings won't be answered —
 * reviewers should pair up to test negotiations on their own listings.
 * Requires the base seed (categories, cities) to have run first.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200`;
const DAY = 24 * 60 * 60 * 1000;

const SELLERS = [
  { key: 1, displayName: 'Rohan Sharma (Demo)' },
  { key: 2, displayName: 'Ananya Iyer (Demo)' },
  { key: 3, displayName: 'Vikram Rao (Demo)' },
  { key: 4, displayName: 'Meera Kapoor (Demo)' },
];
const email = (key: number) => `demo-seller-${key}@example.com`;

type Attr = { slug: string; valueText?: string; valueNumber?: number };
const LISTINGS: {
  seller: number; title: string; price: number; condition: string; category: string; state: string; city: string;
  photo: string; verified?: boolean; daysAgo: number; attributes?: Attr[]; details: string;
}[] = [
  { seller: 1, title: 'iPhone 13 Pro 256GB Sierra Blue', price: 61000, condition: 'LIKE_NEW', category: 'mobile-phones', state: 'MH', city: 'MUM', photo: '1678652197831-2d180705cd2c', verified: true, daysAgo: 1,
    attributes: [{ slug: 'brand', valueText: 'apple' }, { slug: 'storage', valueText: '256-gb' }], details: 'Battery health 88%, always used with a case and screen guard. Box and bill included.' },
  { seller: 2, title: 'Samsung Galaxy S23 Ultra 256GB', price: 74000, condition: 'USED', category: 'mobile-phones', state: 'TG', city: 'HYD', photo: '1678911820864-e2c567c655d7', verified: true, daysAgo: 2,
    attributes: [{ slug: 'brand', valueText: 'samsung' }, { slug: 'storage', valueText: '256-gb' }], details: 'S Pen works perfectly. Small scuff on the frame, screen is flawless. Original charger included.' },
  { seller: 3, title: 'OnePlus 11R 5G 128GB', price: 24500, condition: 'USED', category: 'mobile-phones', state: 'MH', city: 'PUN', photo: '1585060544812-6b45742d762f', daysAgo: 3,
    attributes: [{ slug: 'brand', valueText: 'oneplus' }, { slug: 'storage', valueText: '128-gb' }], details: 'Daily driver for a year, no repairs. Comes with 100W charger.' },
  { seller: 4, title: 'MacBook Air M1, 8GB RAM, 256GB SSD', price: 52000, condition: 'USED', category: 'laptops', state: 'KA', city: 'BLR', photo: '1611186871348-b1ce696e52c9', verified: true, daysAgo: 1,
    details: 'Battery cycle count 210. Used for college work. Original charger and sleeve included.' },
  { seller: 1, title: 'MacBook Pro 14" M1 Pro, 16GB, 512GB', price: 115000, condition: 'LIKE_NEW', category: 'laptops', state: 'DL', city: 'DEL', photo: '1517336714731-489689fd1ca8', daysAgo: 4,
    details: 'Bought in 2023, AppleCare not included. No scratches, kept in a hard case.' },
  { seller: 2, title: 'HP Pavilion 15, i5 11th Gen, 16GB RAM', price: 34000, condition: 'USED', category: 'laptops', state: 'TN', city: 'CHE', photo: '1496181133206-80ce9b88a853', daysAgo: 5,
    details: 'Good for office and study. Battery lasts about 4 hours. Upgraded to 16GB RAM.' },
  { seller: 3, title: 'Sony WH-1000XM4 noise-cancelling headphones', price: 14500, condition: 'LIKE_NEW', category: 'tv-audio', state: 'MH', city: 'MUM', photo: '1505740420928-5e560c06d30e', verified: true, daysAgo: 2,
    details: 'Barely used, comes with case and cable. Noise cancelling works perfectly.' },
  { seller: 4, title: 'Samsung 43" 4K Smart TV (2022)', price: 22000, condition: 'USED', category: 'tv-audio', state: 'WB', city: 'KOL', photo: '1593359677879-a4bb92f829d1', daysAgo: 6,
    details: 'Wall mount and remote included. Moving out, so selling. Pickup only.' },
  { seller: 1, title: 'PlayStation 5 Disc Edition with 2 controllers', price: 38000, condition: 'USED', category: 'tv-audio', state: 'GJ', city: 'AMD', photo: '1606813907291-d86efa9b94db', verified: true, daysAgo: 3,
    details: 'Both controllers in good condition. Box available. Games not included.' },
  { seller: 2, title: 'Apple Watch Series 7, 45mm GPS', price: 18000, condition: 'USED', category: 'mobile-accessories', state: 'KA', city: 'BLR', photo: '1546868871-7041f2a55e12', daysAgo: 7,
    details: 'Battery health 86%. Comes with two straps and the magnetic charger.' },
  { seller: 3, title: 'Royal Enfield Meteor 350, 2022, 9,000 km', price: 175000, condition: 'USED', category: 'bikes', state: 'MH', city: 'PUN', photo: '1558981806-ec527fa84c39', verified: true, daysAgo: 2,
    attributes: [{ slug: 'brand', valueText: 'royal-enfield' }, { slug: 'year', valueNumber: 2022 }], details: 'Single owner, all services at the authorised centre. Papers and insurance up to date.' },
  { seller: 4, title: 'Road bicycle, 21-speed, aluminium frame', price: 12500, condition: 'USED', category: 'bicycles', state: 'KA', city: 'BLR', photo: '1532298229144-0ec0c57515c7', daysAgo: 8,
    details: 'Light frame, new tyres last month. Good for weekend rides.' },
  { seller: 1, title: 'City hybrid cycle, white, medium frame', price: 9800, condition: 'LIKE_NEW', category: 'bicycles', state: 'TN', city: 'CHE', photo: '1485965120184-e220f721d03e', daysAgo: 4,
    details: 'Used for a few months only. Comes with lock and front light.' },
  { seller: 2, title: '3-seater velvet sofa, emerald green', price: 18500, condition: 'USED', category: 'sofas', state: 'DL', city: 'DEL', photo: '1555041469-a586c61ea9bc', verified: true, daysAgo: 3,
    details: 'Very comfortable, no stains or tears. Buyer arranges transport.' },
  { seller: 3, title: 'Yellow accent armchair', price: 6500, condition: 'LIKE_NEW', category: 'sofas', state: 'MH', city: 'MUM', photo: '1586023492125-27b2c045efd7', daysAgo: 5,
    details: 'Solid wood legs, barely used. Fits well in a reading corner.' },
  { seller: 4, title: 'Set of 2 lounge chairs', price: 9000, condition: 'USED', category: 'sofas', state: 'WB', city: 'KOL', photo: '1524758631624-e2822e304c36', daysAgo: 9,
    details: 'From a café that closed. Sturdy and easy to clean.' },
  { seller: 1, title: 'Nike Free Run running shoes, UK 9', price: 3200, condition: 'NEW', category: 'footwear', state: 'TG', city: 'HYD', photo: '1542291026-7eec264c27ff', daysAgo: 1,
    details: 'Unworn, wrong size ordered. Original box included.' },
];

async function remove() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'demo-seller-', endsWith: '@example.com' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.$transaction([
    prisma.offer.deleteMany({ where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] } }),
    prisma.conversation.deleteMany({ where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`✅ Removed ${ids.length} demo seller(s) and their listings.`);
}

async function add() {
  const now = Date.now();
  const sellerIds: Record<number, string> = {};
  for (const s of SELLERS) {
    const existing = await prisma.user.findUnique({ where: { email: email(s.key) } });
    if (existing) { sellerIds[s.key] = existing.id; continue; }
    const code = `BCH-DEMO${s.key}${crypto.randomInt(10, 99)}`.slice(0, 10);
    const user = await prisma.user.create({
      data: {
        userCode: code,
        displayName: s.displayName,
        email: email(s.key),
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), // nobody can sign in
        status: 'ACTIVE',
        role: 'USER',
        emailVerifiedAt: new Date(now - 30 * DAY),
        createdAt: new Date(now - 60 * DAY),
      },
    });
    sellerIds[s.key] = user.id;
  }

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  let created = 0;
  for (const l of LISTINGS) {
    if (await prisma.listing.findFirst({ where: { title: l.title, sellerId: sellerIds[l.seller] } })) continue;
    const category = await prisma.category.findUnique({ where: { slug: l.category } });
    if (!category) { console.warn(`  skipped "${l.title}": category ${l.category} missing (run the base seed first)`); continue; }
    const attributes = [];
    for (const a of l.attributes ?? []) {
      const def = await prisma.attributeDefinition.findUnique({ where: { categoryId_slug: { categoryId: category.id, slug: a.slug } } });
      if (def) attributes.push({ attributeDefinitionId: def.id, valueText: a.valueText ?? null, valueNumber: a.valueNumber ?? null });
    }
    const published = new Date(now - l.daysAgo * DAY);
    const url = img(l.photo);
    await prisma.listing.create({
      data: {
        sellerId: sellerIds[l.seller],
        categoryId: category.id,
        title: l.title,
        description: `${l.details}\n\nThis is a demo listing for the Becho beta — not a real item for sale.`,
        price: l.price,
        currency: 'INR',
        condition: l.condition,
        countryCode: 'IN',
        stateCode: l.state,
        cityCode: l.city,
        status: 'LIVE',
        metadata: { demo: true },
        submittedAt: published,
        approvedAt: published,
        publishedAt: published,
        createdAt: published,
        expiresAt: new Date(published.getTime() + 30 * DAY),
        ...(l.verified && admin ? { verifiedAt: published, verifiedById: admin.id } : {}),
        media: { create: [{ url, storageKey: url, sortOrder: 1 }] },
        attributes: { create: attributes },
      },
    });
    created++;
  }
  console.log(`✅ Demo data ready: ${SELLERS.length} demo sellers, ${created} new listing(s) (${LISTINGS.length} total defined).`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  console.log(`Database: ${new URL(process.env.DATABASE_URL).host}`);
  if (process.argv.includes('--remove')) await remove();
  else await add();
}

main()
  .catch((err) => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
