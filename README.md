# `becho-api`

Becho API — Node.js + TypeScript modular monolith (Express, Prisma, PostgreSQL). Launch market: **India** (INR, +91 phone numbers).

## Architecture

```text
src/
├── config/        # Environment validation (zod)
├── common/        # Middleware (auth, errors, logging), validation helpers, enums
├── modules/       # Feature modules: auth, users, locations, categories, listings,
│                  # sanitization, admin (moderation), chat, favorites, offers, notifications
├── jobs/          # In-process scheduler: listing & offer expiry
└── seed.ts        # Idempotent India seed data
prisma/
├── schema.prisma  # PostgreSQL; JSONB for unstructured data (attributes, metadata, checks)
└── migrations/
test/              # End-to-end tests against a real Postgres test DB
```

**Data model note:** structured entities (users, listings, offers, chats) are relational; flexible data
uses JSONB columns — `Listing.metadata`, `ListingAttribute.valueJson`, `AttributeDefinition.validationConfig`,
`ListingSanitization.reasons/checks`, `Notification.data`, `AuditLog.details`.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:up          # Postgres 16 in Docker on localhost:5433 (also creates becho_test)
npm run db:deploy      # apply migrations
npm run seed           # 8 Indian cities, categories, demo users & listings
npm run dev            # http://localhost:4000/api/v1/health
```

Demo logins (password `password123`): `aarav@example.com`, `priya@example.com`, `admin@becho.in`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled server |
| `npm run typecheck` | Type-check only |
| `npm run db:up` | Start local Postgres (docker compose) |
| `npm run db:migrate` | Create + apply a new migration after editing `schema.prisma` |
| `npm run db:deploy` | Apply pending migrations |
| `npm run db:reset` | Drop, re-migrate and re-seed the dev database |
| `npm run seed` | Seed (safe to run repeatedly) |
| `npm test` | Migrate `becho_test` and run the e2e suite (needs `npm run db:up`) |

## Key behaviours

- **Auth:** 15-min access JWT + rotating 30-day refresh token. New accounts are `PENDING_VERIFICATION`
  until OTP verification (`POST /auth/verify-otp`, authenticated, 5 attempts per code). Selling, chatting
  and offers require a verified account. Outside production the OTP is returned as `devOtp`
  (no SMS/email provider yet — Phase 1).
- **Listings:** `DRAFT → (automated checks) → LIVE | PENDING_REVIEW → LIVE | REJECTED`; `LIVE → RESERVED`
  (offer accepted) `→ SOLD`, or back to `LIVE`; `LIVE → EXPIRED` after 30 days (renewable).
  Non-public listings return 404 except to the owner and moderators. Location must be an active service area.
- **Offers:** buyer and seller are fixed per negotiation; `proposedById` records who made each amount.
  Only the other party can accept/reject/counter; the proposer can withdraw. Accepting reserves the
  listing and rejects competing offers in one transaction. Offers expire after 48h.
- **Responses:** `{ success: true, data }` or `{ success: false, error: { code, message, details? } }`.
- **Production:** `JWT_SECRET` / `JWT_REFRESH_SECRET` must be strong (32+ chars) or the server refuses to start.
  Browser access is limited to `CORS_ORIGINS`.
