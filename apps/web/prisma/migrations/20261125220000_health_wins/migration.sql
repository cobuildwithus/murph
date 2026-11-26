-- Operational metadata: client post id, author FK, ordering/retirement times, edit version,
-- last hourly cheer notification claim. Encrypted content: caption and one envelope per card.
CREATE TABLE "health_post" (
    "id" UUID PRIMARY KEY,
    "author_member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "caption_encrypted" TEXT,
    "cards_encrypted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cheer_push_claimed_at" TIMESTAMPTZ(3)
);
CREATE INDEX "health_post_deleted_at_created_at_id_idx" ON "health_post"("deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "health_post_author_member_id_deleted_at_created_at_id_idx" ON "health_post"("author_member_id", "deleted_at", "created_at" DESC, "id" DESC);

-- Operational metadata: target post FK, cheering member FK, admission time.
CREATE TABLE "health_post_cheer" (
    "post_id" UUID NOT NULL REFERENCES "health_post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("post_id", "member_id")
);
CREATE INDEX "health_post_cheer_member_id_idx" ON "health_post_cheer"("member_id");

-- Operational metadata: client comment id, post/author FKs, audience choice, ordering/
-- retirement/notification claim times. Encrypted content: body, cleared on tombstoning.
CREATE TABLE "health_post_comment" (
    "id" UUID PRIMARY KEY,
    "post_id" UUID NOT NULL REFERENCES "health_post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "author_member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "visibility" TEXT NOT NULL DEFAULT 'everyone' CHECK ("visibility" IN ('everyone', 'poster')),
    "body_encrypted" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "push_claimed_at" TIMESTAMPTZ(3),
    CHECK (("deleted_at" IS NULL) = ("body_encrypted" IS NOT NULL))
);
CREATE INDEX "health_post_comment_post_id_deleted_at_created_at_id_idx" ON "health_post_comment"("post_id", "deleted_at", "created_at" DESC, "id" DESC);
CREATE INDEX "health_post_comment_author_member_id_idx" ON "health_post_comment"("author_member_id");

-- Operational metadata: the member FKs identifying a directed hide and its admission time.
CREATE TABLE "health_feed_hide" (
    "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "hidden_member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("member_id", "hidden_member_id"),
    CHECK ("member_id" <> "hidden_member_id")
);
CREATE INDEX "health_feed_hide_hidden_member_id_member_id_idx" ON "health_feed_hide"("hidden_member_id", "member_id");

-- Operational metadata: member FK, local calendar day, opaque publication revision, generation
-- and validation times. Keyed lookup: member-bound source revision. Encrypted content: candidate set.
CREATE TABLE "health_win_set" (
    "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "day" VARCHAR(10) NOT NULL,
    "revision" UUID NOT NULL,
    "source_revision" TEXT NOT NULL,
    "candidates_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("member_id", "day")
);

-- Operational metadata: attachment id, member FK, published post FK, lifecycle status and
-- registration time. Encrypted content: object key. Deletion purges the object before member cascade.
CREATE TABLE "health_post_attachment" (
    "id" UUID PRIMARY KEY,
    "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "post_id" UUID REFERENCES "health_post"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "storage_key_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('pending', 'ready', 'published', 'retired')),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "health_post_attachment_post_id_key" ON "health_post_attachment"("post_id");
CREATE INDEX "health_post_attachment_member_id_status_created_at_idx" ON "health_post_attachment"("member_id", "status", "created_at");
