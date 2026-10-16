-- CreateTable
CREATE TABLE "game_profile" (
    "member_id" TEXT NOT NULL,
    "first_name_encrypted" TEXT NOT NULL,
    "avatar_key" TEXT,
    "time_zone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_profile_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "game_contact_label" (
    "owner_member_id" TEXT NOT NULL,
    "subject_member_id" TEXT NOT NULL,
    "name_encrypted" TEXT,
    "relationship_encrypted" TEXT,
    "photo_key" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_contact_label_pkey" PRIMARY KEY ("owner_member_id","subject_member_id")
);

-- CreateTable
CREATE TABLE "game_circle" (
    "id" TEXT NOT NULL,
    "hosted_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_circle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT,
    "created_by" TEXT NOT NULL,
    "previous_game_id" TEXT,
    "format" TEXT NOT NULL DEFAULT 'habit_days@1',
    "status" TEXT NOT NULL,
    "void_reason" TEXT,
    "terms" JSONB NOT NULL,
    "terms_words_encrypted" TEXT NOT NULL,
    "invite_token_hash" TEXT,
    "invite_token_encrypted" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "pending_label" JSONB,
    "length_days" INTEGER NOT NULL DEFAULT 7,
    "started_at" TIMESTAMP(3),
    "next_due_at" TIMESTAMP(3),
    "result" JSONB,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_player" (
    "game_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "time_zone" TEXT NOT NULL,
    "day_one" DATE,
    "agreed_terms_version" INTEGER NOT NULL,
    "active_member_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_player_pkey" PRIMARY KEY ("game_id","member_id")
);

-- CreateTable
CREATE TABLE "game_entry" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "day_index" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "text_encrypted" TEXT,
    "data_encrypted" TEXT,
    "media_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capture_age_ms" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_reason" TEXT,

    CONSTRAINT "game_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_ticket" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "game_id" TEXT,
    "stake_key" TEXT NOT NULL,
    "owed_by" TEXT NOT NULL,
    "owed_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_event" (
    "id" BIGSERIAL NOT NULL,
    "game_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "request_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_contact_label_subject_member_id_idx" ON "game_contact_label"("subject_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_invite_token_hash_key" ON "game"("invite_token_hash");

-- CreateIndex
CREATE INDEX "game_next_due_at_idx" ON "game"("next_due_at");

-- CreateIndex
CREATE INDEX "game_circle_id_created_at_idx" ON "game"("circle_id", "created_at");

-- CreateIndex
CREATE INDEX "game_created_by_idx" ON "game"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "game_player_active_member_id_key" ON "game_player"("active_member_id");

-- CreateIndex
CREATE INDEX "game_player_member_id_idx" ON "game_player"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_player_game_id_seat_key" ON "game_player"("game_id", "seat");

-- CreateIndex
CREATE INDEX "game_entry_member_id_idx" ON "game_entry"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_entry_game_id_member_id_day_index_attempt_key" ON "game_entry"("game_id", "member_id", "day_index", "attempt");

-- CreateIndex
CREATE INDEX "game_ticket_owed_to_status_idx" ON "game_ticket"("owed_to", "status");

-- CreateIndex
CREATE INDEX "game_ticket_owed_by_status_idx" ON "game_ticket"("owed_by", "status");

-- CreateIndex
CREATE INDEX "game_ticket_game_id_idx" ON "game_ticket"("game_id");

-- CreateIndex
CREATE INDEX "game_event_game_id_id_idx" ON "game_event"("game_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "game_event_actor_id_request_id_key" ON "game_event"("actor_id", "request_id");

-- AddForeignKey
ALTER TABLE "game_profile" ADD CONSTRAINT "game_profile_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_contact_label" ADD CONSTRAINT "game_contact_label_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_contact_label" ADD CONSTRAINT "game_contact_label_subject_member_id_fkey" FOREIGN KEY ("subject_member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game" ADD CONSTRAINT "game_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "game_circle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game" ADD CONSTRAINT "game_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_player" ADD CONSTRAINT "game_player_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_player" ADD CONSTRAINT "game_player_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_entry" ADD CONSTRAINT "game_entry_game_id_member_id_fkey" FOREIGN KEY ("game_id", "member_id") REFERENCES "game_player"("game_id", "member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ticket" ADD CONSTRAINT "game_ticket_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "game_circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ticket" ADD CONSTRAINT "game_ticket_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ticket" ADD CONSTRAINT "game_ticket_owed_by_fkey" FOREIGN KEY ("owed_by") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ticket" ADD CONSTRAINT "game_ticket_owed_to_fkey" FOREIGN KEY ("owed_to") REFERENCES "game_profile"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Weekly game invariants the app relies on.
ALTER TABLE "game" ADD CONSTRAINT "game_status_check"
  CHECK ("status" IN ('invited', 'live', 'settled', 'void'));
ALTER TABLE "game" ADD CONSTRAINT "game_length_days_check"
  CHECK ("length_days" BETWEEN 1 AND 28);
ALTER TABLE "game_player" ADD CONSTRAINT "game_player_active_member_check"
  CHECK ("active_member_id" IS NULL OR "active_member_id" = "member_id");
ALTER TABLE "game_entry" ADD CONSTRAINT "game_entry_attempt_check"
  CHECK ("attempt" BETWEEN 0 AND 2 AND ("attempt" = 0) = ("kind" = 'excuse'));
ALTER TABLE "game_ticket" ADD CONSTRAINT "game_ticket_status_check"
  CHECK ("status" IN ('open', 'redeemed', 'void'));
