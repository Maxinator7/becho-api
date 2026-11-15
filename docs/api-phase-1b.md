# API additions — Phase 1b

All responses: `{ success: true, data }` or `{ success: false, error: { code, message, details?: [{ path, message }] } }`.
`details` holds per-field validation messages (`path` like `"email"`, `"newPassword"`, `"identifier"`).

## Accounts

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /auth/register` | – | `{ displayName, phone, email, password }` | **phone and email required.** Password 8–128 chars with a letter and a number. Name: letters, spaces, `.'-`. Errors: `PHONE_TAKEN`, `EMAIL_TAKEN`, `VALIDATION_ERROR`. Returns `{ user, tokens, otpChannel:'EMAIL', otpSentTo:'a***@gmail.com', verificationMessage, devOtp? }` |
| `POST /auth/login` | – | `{ identifier, password }` | identifier = email, Indian mobile (any format) or user code `BCH-XXXXXX` (case-insensitive). Errors: `INVALID_CREDENTIALS` 401, `ACCOUNT_LOCKED` 429 (after 10 wrong passwords, 15 min; message says minutes left), `ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED` 403 (message includes reason). Old `{ email | phone, password }` still accepted. |
| `POST /auth/forgot-password` | – | `{ identifier }` | Always 200 with the same `{ message }` whether or not the account exists (a repeat within 60 s silently sends nothing). `devOtp` only on dev/staging. |
| `POST /auth/reset-password` | – | `{ identifier, code, newPassword }` | `INVALID_RESET_CODE` 400 (wrong/expired/used; 5 attempts). Success signs out all sessions; also verifies a pending account. |
| `POST /auth/change-password` | user | `{ currentPassword, newPassword, refreshToken? }` | `INVALID_CURRENT_PASSWORD`. Other sessions signed out (pass current refreshToken to keep this one). |
| `POST /auth/resend-otp` | user | – | Emails a new verification code; `OTP_COOLDOWN` 429. |
| `GET /users/me` | user | – | Now includes `userCode`, `lastLoginAt`. |
| `PATCH /users/me` | user | `{ displayName?, phone? }` | `phone` only if the account has none yet (`PHONE_CHANGE_NOT_ALLOWED`, `PHONE_TAKEN`). |

`user` objects now include `userCode`.

## Listings (seller / public)

- New status **`CHANGES_REQUESTED`**: staff sent it back; hidden from public; seller can `PATCH` (edit) and `POST /:id/submit` again. Deletable.
- `verifiedAt` on listings → show a "Verified" badge. `GET /listings?verified=true` filters to verified ones; `sellerId=` + `excludeId=` give "More from this seller".
- `GET /listings/mine` items include `reviews: [{ action, remark, createdAt }]` (latest seller-visible staff remark, max 1).
- `GET /listings/:id/reviews` (owner) → all seller-visible remarks `[{ id, action, remark, createdAt }]`. Actions: `APPROVED, REJECTED, SUSPENDED, VERIFIED, CHANGES_REQUESTED, REMARK`.
- Editing media: `PATCH /listings/:id { media: [...] }` items can be `{ mediaId }` (keep a file already on the listing — ids from `GET /listings/:id` `media[].id`), `{ uploadId }` (new upload) or `{ url }`. Order = display order; first photo is the cover.
- Listings of suspended/banned sellers are hidden from the public.
- New notification types: `LISTING_CHANGES_REQUESTED`, `LISTING_VERIFIED`, `LISTING_REMARK` (data: `{ listingId, remark }`).

## Admin (role ADMIN or MODERATOR unless noted)

### Users — `/admin/users`
- `GET /admin/users?search=&status=&role=&sort=newest|oldest|last_login|name&page=&limit=` → `{ users, pagination }`. Search matches name, email, mobile (any format) or user code. User: `{ id, userCode, displayName, email, phone, status, role, emailVerifiedAt, phoneVerifiedAt, lockedUntil, lastLoginAt, createdAt, _count: { listings, buyerOffers } }`.
- `GET /admin/users/:id` → `{ user (+failedLoginCount, statusReason), stats: { listingsByStatus, offersMade, offersReceived, dealsAsBuyer, dealsAsSeller, messagesSent }, recentListings[], notes[{ id, note, createdAt, author }], history[{ action, actorId, actor{ displayName, role }|null, details, createdAt }] }`.
- `POST /admin/users/:id/status { status: 'ACTIVE'|'SUSPENDED'|'BANNED', reason }` — **ADMIN only**; reason required (≥5 chars) unless ACTIVE. Can't target self or staff. Blocking signs the user out, cancels their pending offers and hides their listings.
- `POST /admin/users/:id/notes { note }` → created note (internal only).
- `POST /admin/users/:id/unlock` → clears a login lock.

### Listings — `/admin/listings`
- `GET /admin/listings?status=&search=&cityCode=&categoryId=&sellerId=&verified=true|false&sort=newest|oldest|price_desc|price_asc&page=&limit=` → `{ listings, pagination }`. Item: `{ id, title, price, status, condition, cityCode, stateCode, verifiedAt, createdAt, publishedAt, submittedAt, seller{ id, userCode, displayName, status }, category{ id, name }, media[0..1]{ url, mediaType }, sanitization{ status, score }, reviews[0..1]{ action, remark, createdAt }, _count{ offers, conversations, media } }`. Search matches title, description, seller name or user code.
- `GET /admin/listings/:id` → full listing incl. `seller{…email, phone}`, `category{ name, parent{ name } }`, `attributes`, `media[]`, `sanitization{ status, score, reasons, checks }`, `reviews[]{ action, remark, visibleToSeller, createdAt, reviewer{ displayName } }`, `_count{ offers, conversations, favorites }`, `offerStats{ PENDING: n, … }`.
- `POST /admin/listings/:id/verify { remark? }` (LIVE/RESERVED) · `POST /admin/listings/:id/unverify { remark? }`
- `POST /admin/listings/:id/request-changes { remark }` (LIVE, PENDING_REVIEW, SUBMITTED; remark ≥5 chars) → status CHANGES_REQUESTED, pending offers cancelled, seller notified.
- `POST /admin/listings/:id/remarks { remark, visibleToSeller = true }`
- Existing: `GET /admin/moderation/queue`, `POST /admin/moderation/listings/:id/approve { note? } | reject { reason? } | suspend { reason? }` (now also recorded in reviews).

### Analytics — `GET /admin/analytics?days=7..365` (default 30)
```
{ periodDays, generatedAt,
  totals: { users: { total, byStatus{}, active, newInPeriod, signedInInPeriod },
            listings: { byStatus{}, verifiedLive, newInPeriod },
            offersInPeriod, dealsInPeriod, soldInPeriod, messagesInPeriod, conversationsInPeriod },
  series: [{ day:'YYYY-MM-DD' (IST), newUsers, newListings, offers, messages, deals, sold }]  // zero-filled, oldest first
  byCity: [{ cityCode, cityName, count }],      // live listings
  byCategory: [{ name, count }],                // live listings by top-level category
  funnel: { published, withOffer, withDeal, sold },   // listings published in period
  moderation: { queueSize, reviewedInPeriod, avgHoursToApprove|null, actions{ VERIFIED: n, … } } }
```
