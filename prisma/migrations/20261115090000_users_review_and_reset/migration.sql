-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by_id" TEXT;

-- AlterTable
ALTER TABLE "user_verifications" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'VERIFY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "status_reason" TEXT,
ADD COLUMN     "user_code" TEXT;

-- Backfill a code for existing users (BCH- + 6 chars; 0/1 swapped for X/Y to avoid O/I confusion),
-- then make it required.
UPDATE "users"
SET "user_code" = 'BCH-' || upper(translate(substr(md5(random()::text || "id"), 1, 6), '01', 'xy'))
WHERE "user_code" IS NULL;

ALTER TABLE "users" ALTER COLUMN "user_code" SET NOT NULL;

-- CreateTable
CREATE TABLE "listing_reviews" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "remark" TEXT,
    "visible_to_seller" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_reviews_listing_id_created_at_idx" ON "listing_reviews"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "user_notes_user_id_created_at_idx" ON "user_notes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_verifications_user_id_purpose_idx" ON "user_verifications"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_code_key" ON "users"("user_code");

-- AddForeignKey
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

