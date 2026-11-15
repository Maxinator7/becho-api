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
import { uniqueUserCode } from '../src/common/user-code';

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
const emailFor = (phone: string) => `u${phone.replace(/\D/g, '').slice(-10)}@test.in`;

async function registerVerified(name: string, phone: string) {
  const reg = await request(app).post(`${api}/auth/register`).send({ displayName: name, phone, email: emailFor(phone), password: 'password123' });
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
    data: { userCode: await uniqueUserCode(), displayName: 'Admin', email: 'admin@test.in', passwordHash: await bcrypt.hash('password123', 10), status: 'ACTIVE', role: 'ADMIN' },
  });
  const login = await request(app).post(`${api}/auth/login`).send({ email: 'admin@test.in', password: 'password123' });
  adminToken = login.body.data.tokens.accessToken;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth', () => {
  it('normalises Indian phone numbers and rejects invalid ones', async () => {
    const ok = await request(app).post(`${api}/auth/register`).send({ displayName: 'Ravi', phone: '098765 00001', email: 'ravi@test.in', password: 'password123' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.phone).toBe('+919876500001');

    const bad = await request(app).post(`${api}/auth/register`).send({ displayName: 'Ravi', phone: '12345', email: 'ravi2@test.in', password: 'password123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks unverified users from selling and requires auth + correct code to verify', async () => {
    const reg = await request(app).post(`${api}/auth/register`).send({ displayName: 'Neha', phone: '9876500002', email: 'neha@test.in', password: 'password123' });
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

    // Opening the chat clears that notification.
    await request(app).patch(`${api}/conversations/${conv.body.data.id}/read`).set(auth(seller.token)).expect(200);
    const after = await request(app).get(`${api}/notifications/unread-count`).set(auth(seller.token));
    expect(after.body.data.unreadCount).toBe(0);
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

describe('accounts: identity, validation, password reset and lockout', () => {
  it('requires mobile + email, enforces password rules, and issues a user code', async () => {
    const noEmail = await request(app).post(`${api}/auth/register`).send({ displayName: 'Asha', phone: '9822200001', password: 'password123' });
    expect(noEmail.status).toBe(400);
    const weak = await request(app).post(`${api}/auth/register`).send({ displayName: 'Asha', phone: '9822200001', email: 'asha@test.in', password: 'passwordonly' });
    expect(weak.status).toBe(400);
    expect(JSON.stringify(weak.body.error.details)).toContain('letter and one number');

    const ok = await request(app).post(`${api}/auth/register`).send({ displayName: 'Asha Rao', phone: '9822200001', email: 'Asha@Test.in', password: 'password123' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.userCode).toMatch(/^BCH-[0-9A-Z]{6}$/);
    expect(ok.body.data.user.email).toBe('asha@test.in');
    expect(ok.body.data.otpSentTo).toBe('a***@test.in');

    const dupPhone = await request(app).post(`${api}/auth/register`).send({ displayName: 'Other', phone: '+91 98222 00001', email: 'other@test.in', password: 'password123' });
    expect(dupPhone.body.error.code).toBe('PHONE_TAKEN');

    // Sign in with email, mobile or user code.
    for (const identifier of ['asha@test.in', '98222 00001', ok.body.data.user.userCode.toLowerCase()]) {
      const login = await request(app).post(`${api}/auth/login`).send({ identifier, password: 'password123' });
      expect(login.status).toBe(200);
    }
    const badId = await request(app).post(`${api}/auth/login`).send({ identifier: 'not-an-id', password: 'x' });
    expect(badId.status).toBe(400);
  });

  it('resets a forgotten password by email code and signs out old sessions', async () => {
    const user = await registerVerified('Forgetful', '9822200002');
    const unknown = await request(app).post(`${api}/auth/forgot-password`).send({ identifier: 'nobody@test.in' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.devOtp).toBeUndefined();

    const forgot = await request(app).post(`${api}/auth/forgot-password`).send({ identifier: '9822200002' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.message).toBe(unknown.body.data.message); // same answer either way
    const code = forgot.body.data.devOtp as string;
    expect(code).toMatch(/^\d{6}$/);

    // A second request within a minute looks exactly like the unknown-account answer (no new code sent).
    const again = await request(app).post(`${api}/auth/forgot-password`).send({ identifier: '9822200002' });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(unknown.body.data);

    const wrong = await request(app).post(`${api}/auth/reset-password`).send({ identifier: '9822200002', code: code === '000000' ? '111111' : '000000', newPassword: 'newpass123' });
    expect(wrong.body.error.code).toBe('INVALID_RESET_CODE');
    const weak = await request(app).post(`${api}/auth/reset-password`).send({ identifier: '9822200002', code, newPassword: 'short' });
    expect(weak.status).toBe(400);

    const reset = await request(app).post(`${api}/auth/reset-password`).send({ identifier: emailFor('9822200002'), code, newPassword: 'newpass123' });
    expect(reset.status).toBe(200);
    expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9822200002', password: 'password123' })).status).toBe(401);
    expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9822200002', password: 'newpass123' })).status).toBe(200);
    expect((await request(app).post(`${api}/auth/refresh`).send({ refreshToken: user.refresh })).status).toBe(401);
    // A used code can't be replayed.
    expect((await request(app).post(`${api}/auth/reset-password`).send({ identifier: '9822200002', code, newPassword: 'another123' })).body.error.code).toBe('INVALID_RESET_CODE');
  });

  it('changes password when signed in', async () => {
    const user = await registerVerified('Changer', '9822200003');
    const bad = await request(app).post(`${api}/auth/change-password`).set(auth(user.token)).send({ currentPassword: 'wrong1234', newPassword: 'fresh1234' });
    expect(bad.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    const ok = await request(app).post(`${api}/auth/change-password`).set(auth(user.token)).send({ currentPassword: 'password123', newPassword: 'fresh1234' });
    expect(ok.status).toBe(200);
    expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9822200003', password: 'fresh1234' })).status).toBe(200);
  });

  it('locks an account after 10 wrong passwords until it expires or staff unlock it', async () => {
    const user = await registerVerified('Target', '9822200004');
    for (let i = 0; i < 9; i++) {
      expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9822200004', password: 'wrongpass1' })).status).toBe(401);
    }
    const tenth = await request(app).post(`${api}/auth/login`).send({ identifier: '9822200004', password: 'wrongpass1' });
    expect(tenth.status).toBe(429);
    expect(tenth.body.error.code).toBe('ACCOUNT_LOCKED');
    const correctWhileLocked = await request(app).post(`${api}/auth/login`).send({ identifier: '9822200004', password: 'password123' });
    expect(correctWhileLocked.body.error.code).toBe('ACCOUNT_LOCKED');

    await request(app).post(`${api}/admin/users/${user.id}/unlock`).set(auth(adminToken)).expect(200);
    expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9822200004', password: 'password123' })).status).toBe(200);
  });

  it('lets an older account add a mobile number once', async () => {
    const legacy = await prisma.user.create({
      data: { userCode: await uniqueUserCode(), displayName: 'Legacy', email: 'legacy@test.in', passwordHash: await bcrypt.hash('password123', 10), status: 'ACTIVE' },
    });
    const login = await request(app).post(`${api}/auth/login`).send({ identifier: 'legacy@test.in', password: 'password123' });
    const token = login.body.data.tokens.accessToken;
    const taken = await request(app).patch(`${api}/users/me`).set(auth(token)).send({ phone: '9822200004' });
    expect(taken.body.error.code).toBe('PHONE_TAKEN');
    const added = await request(app).patch(`${api}/users/me`).set(auth(token)).send({ phone: '98222 00009' });
    expect(added.body.data.phone).toBe('+919822200009');
    const change = await request(app).patch(`${api}/users/me`).set(auth(token)).send({ phone: '9822200010' });
    expect(change.body.error.code).toBe('PHONE_CHANGE_NOT_ALLOWED');
    expect(legacy.id).toBeDefined();
  });
});

describe('admin: users', () => {
  it('searches and reviews users, and suspends a user (blocking login and hiding listings)', async () => {
    const seller = await registerVerified('Shady Seller', '9833300001');
    const listing = await createLive(seller.token, { title: 'Bajaj mixer grinder 750W' });
    const profile = await request(app).get(`${api}/users/me`).set(auth(seller.token));
    const code = profile.body.data.userCode as string;

    expect((await request(app).get(`${api}/admin/users`).set(auth(seller.token))).status).toBe(403);
    for (const search of [code, '98333 00001', 'shady']) {
      const found = await request(app).get(`${api}/admin/users`).query({ search }).set(auth(adminToken));
      expect(found.body.data.users.map((u: { id: string }) => u.id)).toContain(seller.id);
    }

    const note = await request(app).post(`${api}/admin/users/${seller.id}/notes`).set(auth(adminToken)).send({ note: 'Called about duplicate listings' });
    expect(note.status).toBe(201);
    // A user-code search doesn't also match phones that merely share a digit.
    const byCode = await request(app).get(`${api}/admin/users`).query({ search: code }).set(auth(adminToken));
    expect(byCode.body.data.users).toHaveLength(1);
    const detail = await request(app).get(`${api}/admin/users/${seller.id}`).set(auth(adminToken));
    expect(detail.body.data.stats.listingsByStatus.LIVE).toBe(1);
    expect(detail.body.data.notes[0].note).toBe('Called about duplicate listings');

    const noReason = await request(app).post(`${api}/admin/users/${seller.id}/status`).set(auth(adminToken)).send({ status: 'SUSPENDED' });
    expect(noReason.status).toBe(400);
    await request(app).post(`${api}/admin/users/${seller.id}/status`).set(auth(adminToken)).send({ status: 'SUSPENDED', reason: 'Fake listings reported' }).expect(200);

    const blocked = await request(app).post(`${api}/auth/login`).send({ identifier: '9833300001', password: 'password123' });
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(blocked.body.error.message).toContain('Fake listings reported');
    expect((await request(app).post(`${api}/auth/refresh`).send({ refreshToken: seller.refresh })).status).toBe(401);
    expect((await request(app).get(`${api}/listings/${listing.id}`)).status).toBe(404);
    const search = await request(app).get(`${api}/listings`).query({ search: 'mixer grinder' });
    expect(search.body.data.pagination.total).toBe(0);

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.in' } });
    expect((await request(app).post(`${api}/admin/users/${adminUser.id}/status`).set(auth(adminToken)).send({ status: 'BANNED', reason: 'testing self' })).status).toBe(400);

    const history = await request(app).get(`${api}/admin/users/${seller.id}`).set(auth(adminToken));
    expect(history.body.data.history[0].actor.displayName).toBe('Admin');
    await request(app).post(`${api}/admin/users/${seller.id}/status`).set(auth(adminToken)).send({ status: 'ACTIVE' }).expect(200);
    expect((await request(app).post(`${api}/auth/login`).send({ identifier: '9833300001', password: 'password123' })).status).toBe(200);
    expect((await request(app).get(`${api}/listings/${listing.id}`)).status).toBe(200);
  });
});

describe('admin: listing review', () => {
  it('verifies listings and shows the badge publicly', async () => {
    const seller = await registerVerified('Badge Seller', '9844400001');
    const listing = await createLive(seller.token, { title: 'Godrej steel almirah 2 door' });
    await request(app).post(`${api}/admin/listings/${listing.id}/verify`).set(auth(adminToken)).send({}).expect(200);
    const pub = await request(app).get(`${api}/listings/${listing.id}`);
    expect(pub.body.data.verifiedAt).toBeTruthy();
    const verifiedOnly = await request(app).get(`${api}/listings`).query({ verified: 'true' });
    expect(verifiedOnly.body.data.listings.map((l: { id: string }) => l.id)).toContain(listing.id);
    await new Promise((r) => setTimeout(r, 100));
    const notes = await request(app).get(`${api}/notifications`).set(auth(seller.token));
    expect(notes.body.data.notifications.some((n: { type: string }) => n.type === 'LISTING_VERIFIED')).toBe(true);
  });

  it('sends a listing back for changes; the seller edits (keeping photos) and resubmits', async () => {
    const seller = await registerVerified('Fix Seller', '9844400002');
    const buyer = await registerVerified('Fix Buyer', '9844400003');
    const created = await request(app).post(`${api}/listings`).set(auth(seller.token)).send(listingBody({ title: 'Redmi Note 12 phone', media: [{ url: 'https://example.com/redmi.jpg' }] }));
    await request(app).post(`${api}/listings/${created.body.data.id}/submit`).set(auth(seller.token)).expect(200);
    const listingId = created.body.data.id as string;
    await request(app).post(`${api}/offers`).set(auth(buyer.token)).send({ listingId, amount: 9000 }).expect(201);

    const tooShort = await request(app).post(`${api}/admin/listings/${listingId}/request-changes`).set(auth(adminToken)).send({ remark: 'no' });
    expect(tooShort.status).toBe(400);
    await request(app).post(`${api}/admin/listings/${listingId}/request-changes`).set(auth(adminToken)).send({ remark: 'Please add the storage size to the title' }).expect(200);
    await request(app).post(`${api}/admin/listings/${listingId}/remarks`).set(auth(adminToken)).send({ remark: 'Possible duplicate of another post', visibleToSeller: false }).expect(201);

    expect((await request(app).get(`${api}/listings/${listingId}`)).status).toBe(404);
    const offers = await prisma.offer.findMany({ where: { listingId } });
    expect(offers.every((o) => o.status === 'CANCELLED')).toBe(true);

    const mine = await request(app).get(`${api}/listings/mine`).set(auth(seller.token));
    const mineItem = mine.body.data.find((l: { id: string }) => l.id === listingId);
    expect(mineItem.status).toBe('CHANGES_REQUESTED');
    expect(mineItem.reviews[0].remark).toBe('Please add the storage size to the title');
    const reviews = await request(app).get(`${api}/listings/${listingId}/reviews`).set(auth(seller.token));
    expect(reviews.body.data.map((r: { remark: string }) => r.remark)).not.toContain('Possible duplicate of another post');

    const detail = await request(app).get(`${api}/listings/${listingId}`).set(auth(seller.token));
    const mediaId = detail.body.data.media[0].id;
    const edit = await request(app).patch(`${api}/listings/${listingId}`).set(auth(seller.token)).send({ title: 'Redmi Note 12 phone 128GB', media: [{ mediaId }] });
    expect(edit.status).toBe(200);
    expect(edit.body.data.media[0].url).toBe('https://example.com/redmi.jpg');
    const resubmit = await request(app).post(`${api}/listings/${listingId}/submit`).set(auth(seller.token));
    expect(resubmit.body.data.status).toBe('LIVE');

    const adminView = await request(app).get(`${api}/admin/listings/${listingId}`).set(auth(adminToken));
    expect(adminView.body.data.reviews.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['CHANGES_REQUESTED', 'REMARK']));
    const list = await request(app).get(`${api}/admin/listings`).query({ search: 'redmi' }).set(auth(adminToken));
    expect(list.body.data.listings[0].seller.userCode).toMatch(/^BCH-/);
  });
});

describe('admin: analytics', () => {
  it('returns totals, a zero-filled daily series and breakdowns', async () => {
    const res = await request(app).get(`${api}/admin/analytics`).query({ days: 14 }).set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.series).toHaveLength(14);
    expect(d.series.at(-1).newUsers).toBeGreaterThan(0);
    expect(d.totals.users.total).toBeGreaterThan(5);
    expect(d.byCity[0].cityName).toBe('Mumbai');
    expect(d.funnel.published).toBeGreaterThan(0);
    expect(d.funnel.sold).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`${api}/admin/analytics`).set(auth((await registerVerified('Nosy', '9855500001')).token))).status).toBe(403);
  });
});
