/**
 * End-to-end flow against a real Postgres test database (becho_test).
 * Run with: npm test   (requires `npm run db:up`)
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/common/prisma';
import { runMaintenanceJobs } from '../src/jobs/scheduler';
import { env } from '../src/config/env';
import { storage } from '../src/modules/media/storage';

const app = createApp();
const api = '/api/v1';

let categoryId: string; // leaf: Mobile Phones (has required Brand attribute)
let parentCategoryId: string; // Mobiles
let brandAttrId: string;
let adminToken: string;

async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** Registers with an Indian phone number, verifies via the dev OTP, returns ACTIVE tokens. */
async function registerVerified(name: string, phone: string) {
  const reg = await request(app).post(`${api}/auth/register`).send({ displayName: name, phone, password: 'password123' });
  expect(reg.status).toBe(201);
  const ver = await request(app)
    .post(`${api}/auth/verify-otp`)
    .set('Authorization', `Bearer ${reg.body.data.tokens.accessToken}`)
    .send({ code: reg.body.data.devOtp });
  expect(ver.status).toBe(200);
  return { id: reg.body.data.user.id as string, token: ver.body.data.tokens.accessToken as string, refresh: ver.body.data.tokens.refreshToken as string };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function listingBody(overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    title: 'iPhone 13 128GB Blue',
    description: 'Good condition, bill available, battery health 88%.',
    price: 35000,
    stateCode: 'MH',
    cityCode: 'MUM',
    attributes: [{ attributeDefinitionId: brandAttrId, valueText: 'apple' }],
    media: [{ url: 'https://example.com/a.jpg' }],
    ...overrides,
  };
}

async function createLive(token: string, overrides: Record<string, unknown> = {}) {
  const created = await request(app).post(`${api}/listings`).set(auth(token)).send(listingBody(overrides));
  expect(created.status).toBe(201);
  const submitted = await request(app).post(`${api}/listings/${created.body.data.id}/submit`).set(auth(token));
  expect(submitted.status).toBe(200);
  return submitted.body.data;
}

beforeAll(async () => {
  // Tests create many listings per user; the daily-limit test lowers this itself.
  env.LISTINGS_PER_DAY = 1000;
  await resetDb();
  await prisma.serviceArea.create({
    data: { countryCode: 'IN', stateCode: 'MH', stateName: 'Maharashtra', cityCode: 'MUM', cityName: 'Mumbai' },
  });
  const parent = await prisma.category.create({ data: { name: 'Mobiles', slug: 'mobiles' } });
  const leaf = await prisma.category.create({ data: { name: 'Mobile Phones', slug: 'mobile-phones', parentId: parent.id } });
  const brand = await prisma.attributeDefinition.create({
    data: { categoryId: leaf.id, name: 'Brand', slug: 'brand', dataType: 'SELECT', isRequired: true },
  });
  parentCategoryId = parent.id;
  categoryId = leaf.id;
  brandAttrId = brand.id;

  await prisma.user.create({
    data: { displayName: 'Admin', email: 'admin@test.in', passwordHash: await bcrypt.hash('password123', 10), status: 'ACTIVE', role: 'ADMIN' },
  });
  const login = await request(app).post(`${api}/auth/login`).send({ email: 'admin@test.in', password: 'password123' });
  adminToken = login.body.data.tokens.accessToken;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth', () => {
  it('normalises Indian phone numbers and rejects invalid ones', async () => {
    const ok = await request(app).post(`${api}/auth/register`).send({ displayName: 'Ravi', phone: '098765 00001', password: 'password123' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.phone).toBe('+919876500001');

    const bad = await request(app).post(`${api}/auth/register`).send({ displayName: 'Ravi', phone: '12345', password: 'password123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks unverified users from selling and requires auth + correct code to verify', async () => {
    const reg = await request(app).post(`${api}/auth/register`).send({ displayName: 'Neha', phone: '9876500002', password: 'password123' });
    const token = reg.body.data.tokens.accessToken;

    const sell = await request(app).post(`${api}/listings`).set(auth(token)).send(listingBody());
    expect(sell.status).toBe(403);
    expect(sell.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');

    expect((await request(app).post(`${api}/auth/verify-otp`).send({ code: reg.body.data.devOtp })).status).toBe(401);

    const wrongCode = reg.body.data.devOtp === '000000' ? '111111' : '000000';
    const wrong = await request(app).post(`${api}/auth/verify-otp`).set(auth(token)).send({ code: wrongCode });
    expect(wrong.body.error.code).toBe('INVALID_OTP');

    const ok = await request(app).post(`${api}/auth/verify-otp`).set(auth(token)).send({ code: reg.body.data.devOtp });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.status).toBe('ACTIVE');
    // The fresh token carries ACTIVE status, so selling works immediately.
    const sellAgain = await request(app).post(`${api}/listings`).set(auth(ok.body.data.tokens.accessToken)).send(listingBody());
    expect(sellAgain.status).toBe(201);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const user = await registerVerified('Kiran', '9876500003');
    const first = await request(app).post(`${api}/auth/refresh`).send({ refreshToken: user.refresh });
    expect(first.status).toBe(200);
    const reuse = await request(app).post(`${api}/auth/refresh`).send({ refreshToken: user.refresh });
    expect(reuse.status).toBe(401);
  });
});

describe('listings', () => {
  let seller: Awaited<ReturnType<typeof registerVerified>>;
  beforeAll(async () => {
    seller = await registerVerified('Seller One', '9876500010');
  });

  it('rejects cities outside service areas', async () => {
    const res = await request(app).post(`${api}/listings`).set(auth(seller.token)).send(listingBody({ stateCode: 'DL', cityCode: 'DEL' }));
    expect(res.body.error.code).toBe('AREA_NOT_SERVED');
  });

  it('requires mandatory attributes before submit', async () => {
    const created = await request(app).post(`${api}/listings`).set(auth(seller.token)).send(listingBody({ attributes: [] }));
    const submit = await request(app).post(`${api}/listings/${created.body.data.id}/submit`).set(auth(seller.token));
    expect(submit.body.error.code).toBe('MISSING_ATTRIBUTES');
  });

  it('publishes, lists under data.listings, searches case-insensitively and matches parent categories', async () => {
    const live = await createLive(seller.token, { title: 'Pixel 7 Pro Obsidian 256GB' });
    expect(live.status).toBe('LIVE');
    expect(live.currency).toBe('INR');

    const search = await request(app).get(`${api}/listings`).query({ search: 'PIXEL' });
    expect(search.body.data.listings.map((l: any) => l.id)).toContain(live.id);
    expect(search.body.data.pagination.total).toBeGreaterThanOrEqual(1);

    const byParent = await request(app).get(`${api}/listings`).query({ categoryId: parentCategoryId });
    expect(byParent.body.data.listings.map((l: any) => l.id)).toContain(live.id);
  });

  it('hides drafts from the public but not from the owner', async () => {
    const draft = await request(app).post(`${api}/listings`).set(auth(seller.token)).send(listingBody());
    const id = draft.body.data.id;
    expect((await request(app).get(`${api}/listings/${id}`)).status).toBe(404);
    expect((await request(app).get(`${api}/listings/${id}`).set(auth(seller.token))).status).toBe(200);
  });

  it('does not flag "gunmetal" but sends "gun" to moderation, where admin can approve once', async () => {
    const clean = await createLive(seller.token, { title: 'Royal Enfield gunmetal grey tank cover' });
    expect(clean.status).toBe('LIVE');

    const flagged = await createLive(seller.token, { title: 'Toy gun for kids, never used' });
    expect(flagged.status).toBe('PENDING_REVIEW');

    const queue = await request(app).get(`${api}/admin/moderation/queue`).set(auth(adminToken));
    const item = queue.body.data.find((l: any) => l.id === flagged.id);
    expect(item.sanitization.reasons).toEqual(['PROHIBITED_CONTENT']); // JSON array, not a string

    expect((await request(app).post(`${api}/admin/moderation/listings/${flagged.id}/approve`).set(auth(adminToken))).status).toBe(200);
    const again = await request(app).post(`${api}/admin/moderation/listings/${flagged.id}/approve`).set(auth(adminToken));
    expect(again.body.error.code).toBe('INVALID_LISTING_STATE');
  });

  it('does not allow non-staff into moderation', async () => {
    expect((await request(app).get(`${api}/admin/moderation/queue`).set(auth(seller.token))).status).toBe(403);
  });
});

describe('chat and offer negotiation', () => {
  it('runs offer → counter → accept (by buyer) → reserved → available → sold', async () => {
    const seller = await registerVerified('Seller Two', '9876500020');
    const buyer = await registerVerified('Buyer One', '9876500021');
    const rival = await registerVerified('Buyer Two', '9876500022');
    const listing = await createLive(seller.token, { title: 'OnePlus 11 5G 256GB', price: 40000 });

    // Chat
    const conv = await request(app).post(`${api}/conversations/initiate`).set(auth(buyer.token)).send({ listingId: listing.id });
    expect(conv.status).toBe(200);
    await request(app).post(`${api}/conversations/${conv.body.data.id}/messages`).set(auth(buyer.token)).send({ content: 'Is this available?' }).expect(201);
    const sellerView = await request(app).get(`${api}/conversations/${conv.body.data.id}/messages`).set(auth(seller.token));
    expect(sellerView.body.data.messages).toHaveLength(1);
    expect((await request(app).get(`${api}/conversations/${conv.body.data.id}/messages`).set(auth(rival.token))).status).toBe(403);

    // Offers
    const offer = await request(app).post(`${api}/offers`).set(auth(buyer.token)).send({ listingId: listing.id, amount: 34000 });
    expect(offer.status).toBe(201);
    const rivalOffer = await request(app).post(`${api}/offers`).set(auth(rival.token)).send({ listingId: listing.id, amount: 30000 });

    const selfAccept = await request(app).post(`${api}/offers/${offer.body.data.id}/accept`).set(auth(buyer.token));
    expect(selfAccept.body.error.code).toBe('OWN_OFFER');

    const counter = await request(app).post(`${api}/offers/${offer.body.data.id}/counter`).set(auth(seller.token)).send({ amount: 37000 });
    expect(counter.status).toBe(201);
    expect(counter.body.data.proposedById).toBe(seller.id);

    // Previously impossible: buyer accepts the seller's counter.
    const accepted = await request(app).post(`${api}/offers/${counter.body.data.id}/accept`).set(auth(buyer.token));
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('ACCEPTED');

    const afterAccept = await request(app).get(`${api}/listings/${listing.id}`);
    expect(afterAccept.body.data.status).toBe('RESERVED');
    expect((await prisma.offer.findUnique({ where: { id: rivalOffer.body.data.id } }))!.status).toBe('REJECTED');

    const late = await request(app).post(`${api}/offers`).set(auth(rival.token)).send({ listingId: listing.id, amount: 39000 });
    expect(late.body.error.code).toBe('LISTING_NOT_LIVE');

    // The proposer of the accepted amount (the seller, via their counter) is notified.
    // Notifications are fire-and-forget, so poll briefly.
    let acceptedNote: any;
    for (let i = 0; i < 20 && !acceptedNote; i++) {
      const notes = await request(app).get(`${api}/notifications`).set(auth(seller.token));
      acceptedNote = notes.body.data.notifications.find((n: any) => n.type === 'OFFER_ACCEPTED');
      if (!acceptedNote) await new Promise((r) => setTimeout(r, 50));
    }
    expect(acceptedNote.body).toContain('₹37,000');
    expect(acceptedNote.data.offerId).toBe(counter.body.data.id);

    // Deal falls through, then sells
    expect((await request(app).post(`${api}/listings/${listing.id}/mark-available`).set(auth(seller.token))).body.data.status).toBe('LIVE');
    expect((await request(app).post(`${api}/listings/${listing.id}/mark-sold`).set(auth(seller.token))).body.data.status).toBe('SOLD');
    const resubmit = await request(app).post(`${api}/listings/${listing.id}/submit`).set(auth(seller.token));
    expect(resubmit.body.error.code).toBe('LISTING_NOT_SUBMITTABLE');
  });
});

describe('background jobs', () => {
  it('expires listings and offers past their expiry', async () => {
    const seller = await registerVerified('Seller Three', '9876500030');
    const buyer = await registerVerified('Buyer Three', '9876500031');
    const listing = await createLive(seller.token, { title: 'Redmi Note 12 Pro 128GB' });
    const otherListing = await createLive(seller.token, { title: 'Realme Narzo 60 128GB' });
    const offer = await request(app).post(`${api}/offers`).set(auth(buyer.token)).send({ listingId: otherListing.id, amount: 9000 });

    await prisma.listing.update({ where: { id: listing.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.offer.update({ where: { id: offer.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await runMaintenanceJobs();
    expect(result.expiredListings).toBeGreaterThanOrEqual(1);
    expect(result.expiredOffers).toBeGreaterThanOrEqual(1);
    expect((await prisma.listing.findUnique({ where: { id: listing.id } }))!.status).toBe('EXPIRED');
    expect((await prisma.offer.findUnique({ where: { id: offer.body.data.id } }))!.status).toBe('EXPIRED');

    const renewed = await request(app).post(`${api}/listings/${listing.id}/renew`).set(auth(seller.token));
    expect(renewed.body.data.status).toBe('LIVE');
  });
});

describe('negotiation shows up in chat and notifications', () => {
  it('posts offer events into the conversation and links offer notifications to it', async () => {
    const seller = await registerVerified('Chat Seller', '9811100001');
    const buyer = await registerVerified('Chat Buyer', '9811100002');
    const listing = await createLive(seller.token, { title: 'Dell laptop i5 8GB' });

    // Offer made from the listing page, with no prior chat: conversation is created.
    const offer = await request(app).post(`${api}/offers`).set(auth(buyer.token)).send({ listingId: listing.id, amount: 30000 });
    expect(offer.status).toBe(201);
    const counter = await request(app).post(`${api}/offers/${offer.body.data.id}/counter`).set(auth(seller.token)).send({ amount: 33000 });
    expect(counter.status).toBe(201);
    const accept = await request(app).post(`${api}/offers/${counter.body.data.id}/accept`).set(auth(buyer.token));
    expect(accept.status).toBe(200);

    const convs = await request(app).get(`${api}/conversations`).set(auth(seller.token));
    const conv = convs.body.data.find((c: { listingId: string }) => c.listingId === listing.id);
    expect(conv).toBeDefined();
    const thread = await request(app).get(`${api}/conversations/${conv.id}/messages`).set(auth(buyer.token));
    const events = thread.body.data.messages.filter((m: { kind: string }) => m.kind === 'EVENT');
    expect(events.map((m: { metadata: { event: string } }) => m.metadata.event)).toEqual(['OFFER_MADE', 'OFFER_COUNTERED', 'OFFER_ACCEPTED']);
    expect(events[2].content).toContain('₹33,000');

    // Seller's "new offer" notification deep-links to the chat.
    const sellerNotes = await request(app).get(`${api}/notifications`).set(auth(seller.token));
    const offerNote = sellerNotes.body.data.notifications.find((n: { type: string }) => n.type === 'OFFER_CREATED');
    expect(offerNote.data.conversationId).toBe(conv.id);

    // Marking sold tells the reserved buyer, in chat and by notification.
    await request(app).post(`${api}/listings/${listing.id}/mark-sold`).set(auth(seller.token)).expect(200);
    const after = await request(app).get(`${api}/conversations/${conv.id}/messages`).set(auth(buyer.token));
    expect(after.body.data.messages.at(-1).metadata.event).toBe('LISTING_SOLD');
    await new Promise((r) => setTimeout(r, 100)); // notifications are fire-and-forget
    const buyerNotes = await request(app).get(`${api}/notifications`).set(auth(buyer.token));
    expect(buyerNotes.body.data.notifications.some((n: { type: string }) => n.type === 'LISTING_SOLD')).toBe(true);
  });

  it('groups unread chat messages into one notification per conversation', async () => {
    const seller = await registerVerified('Msg Seller', '9811100003');
    const buyer = await registerVerified('Msg Buyer', '9811100004');
    const listing = await createLive(seller.token, { title: 'Wooden study table' });
    const conv = await request(app).post(`${api}/conversations/initiate`).set(auth(buyer.token)).send({ listingId: listing.id });
    for (const text of ['Hi', 'Is it available?', 'Can I see it today?']) {
      await request(app).post(`${api}/conversations/${conv.body.data.id}/messages`).set(auth(buyer.token)).send({ content: text }).expect(201);
      await new Promise((r) => setTimeout(r, 50));
    }
    const notes = await request(app).get(`${api}/notifications`).set(auth(seller.token));
    const msgNotes = notes.body.data.notifications.filter((n: { type: string }) => n.type === 'MESSAGE_RECEIVED');
    expect(msgNotes).toHaveLength(1);
    expect(msgNotes[0].data.count).toBe(3);
    const unread = await request(app).get(`${api}/notifications/unread-count`).set(auth(seller.token));
    expect(unread.body.data.unreadCount).toBe(1);
  });
});

describe('media uploads and posting limits', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

  async function upload(token: string, contentType = 'image/png', body = png) {
    const res = await request(app).post(`${api}/media/uploads`).set(auth(token)).send({ contentType, size: body.length });
    expect(res.status).toBe(201);
    const path = new URL(res.body.data.uploadUrl).pathname + new URL(res.body.data.uploadUrl).search;
    await request(app).put(path).set('Content-Type', contentType).send(body).expect(200);
    return res.body.data as { uploadId: string; publicUrl: string };
  }

  it('publishes limits and rejects bad types, oversized files and over-long videos', async () => {
    const user = await registerVerified('Uploader', '9811100005');
    const limits = await request(app).get(`${api}/media/limits`);
    expect(limits.body.data.maxImageBytes).toBe(5 * 1024 * 1024);
    expect(limits.body.data.listingsPerDay).toBeGreaterThan(0);

    const pdf = await request(app).post(`${api}/media/uploads`).set(auth(user.token)).send({ contentType: 'application/pdf', size: 100 });
    expect(pdf.body.error.code).toBe('MEDIA_TYPE_NOT_ALLOWED');
    const big = await request(app).post(`${api}/media/uploads`).set(auth(user.token)).send({ contentType: 'image/jpeg', size: 6 * 1024 * 1024 });
    expect(big.body.error.code).toBe('MEDIA_TOO_LARGE');
    const long = await request(app).post(`${api}/media/uploads`).set(auth(user.token)).send({ contentType: 'video/mp4', size: 1000, durationSeconds: 90 });
    expect(long.body.error.code).toBe('VIDEO_TOO_LONG');
  });

  it('attaches uploaded photos to a listing once, and refuses unfinished uploads', async () => {
    const user = await registerVerified('Photo Seller', '9811100006');
    const other = await registerVerified('Photo Thief', '9811100007');
    const photo = await upload(user.token);

    const created = await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody({ media: [{ uploadId: photo.uploadId }] }));
    expect(created.status).toBe(201);
    expect(created.body.data.media[0].url).toBe(photo.publicUrl);
    expect(created.body.data.media[0].mediaType).toBe('IMAGE');
    const served = await request(app).get(new URL(photo.publicUrl).pathname);
    expect(served.status).toBe(200);

    // Same file can't be reused by another listing, nor by another user.
    const reuse = await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody({ media: [{ uploadId: photo.uploadId }] }));
    expect(reuse.body.error.code).toBe('UPLOAD_ALREADY_USED');
    const stolen = await request(app).post(`${api}/listings`).set(auth(other.token)).send(listingBody({ media: [{ uploadId: photo.uploadId }] }));
    expect(stolen.body.error.code).toBe('UPLOAD_NOT_FOUND');

    // Upload URL requested but file never sent.
    const pending = await request(app).post(`${api}/media/uploads`).set(auth(user.token)).send({ contentType: 'image/png', size: png.length });
    const incomplete = await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody({ media: [{ uploadId: pending.body.data.uploadId }] }));
    expect(incomplete.body.error.code).toBe('UPLOAD_INCOMPLETE');

    await storage.delete(created.body.data.media[0].storageKey);
  });

  it('enforces the per-listing photo limit and the daily listing limit', async () => {
    const user = await registerVerified('Busy Seller', '9811100008');
    const original = env.MEDIA_MAX_IMAGES_PER_LISTING;
    env.MEDIA_MAX_IMAGES_PER_LISTING = 1;
    const a = await upload(user.token);
    const b = await upload(user.token);
    const tooMany = await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody({ media: [{ uploadId: a.uploadId }, { uploadId: b.uploadId }] }));
    env.MEDIA_MAX_IMAGES_PER_LISTING = original;
    expect(tooMany.body.error.code).toBe('TOO_MANY_PHOTOS');

    env.LISTINGS_PER_DAY = 2;
    try {
      await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody()).expect(201);
      await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody()).expect(201);
      const third = await request(app).post(`${api}/listings`).set(auth(user.token)).send(listingBody());
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('LISTING_DAILY_LIMIT');
    } finally {
      env.LISTINGS_PER_DAY = 1000;
    }
    await storage.delete(`listings/${user.id}/${a.uploadId}.png`);
    await storage.delete(`listings/${user.id}/${b.uploadId}.png`);
  });

  it('cleans up uploads that were never attached', async () => {
    const user = await registerVerified('Abandoner', '9811100009');
    const photo = await upload(user.token);
    await prisma.mediaUpload.update({ where: { id: photo.uploadId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const result = await runMaintenanceJobs();
    expect(result.deletedUploads).toBeGreaterThanOrEqual(1);
    expect(await prisma.mediaUpload.findUnique({ where: { id: photo.uploadId } })).toBeNull();
    expect(await storage.head(`listings/${user.id}/${photo.uploadId}.png`)).toBeNull();
  });
});
