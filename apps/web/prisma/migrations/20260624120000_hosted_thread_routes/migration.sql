CREATE TABLE "hosted_thread_container" (
    "member_id" TEXT NOT NULL,
    "owner_member_id" TEXT NOT NULL,
    "monthly_usage_limit_usd_micros" BIGINT NOT NULL DEFAULT 4500000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_thread_container_pkey" PRIMARY KEY ("member_id")
);

CREATE TABLE "hosted_thread_route" (
    "channel" TEXT NOT NULL,
    "thread_lookup_key" TEXT NOT NULL,
    "container_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_thread_route_pkey" PRIMARY KEY ("channel", "thread_lookup_key")
);

CREATE INDEX "hosted_thread_container_owner_member_id_idx"
  ON "hosted_thread_container"("owner_member_id");

CREATE INDEX "hosted_thread_route_container_member_id_idx"
  ON "hosted_thread_route"("container_member_id");

ALTER TABLE "hosted_thread_container"
  ADD CONSTRAINT "hosted_thread_container_member_id_fkey"
  FOREIGN KEY ("member_id")
  REFERENCES "hosted_member"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "hosted_thread_container"
  ADD CONSTRAINT "hosted_thread_container_owner_member_id_fkey"
  FOREIGN KEY ("owner_member_id")
  REFERENCES "hosted_member"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "hosted_thread_route"
  ADD CONSTRAINT "hosted_thread_route_container_member_id_fkey"
  FOREIGN KEY ("container_member_id")
  REFERENCES "hosted_thread_container"("member_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "hosted_thread_route"
  ADD CONSTRAINT "hosted_thread_route_channel_check"
  CHECK ("channel" IN ('email','linq','telegram'));

ALTER TABLE "hosted_thread_container"
  ADD CONSTRAINT "hosted_thread_container_monthly_usage_limit_positive_check"
  CHECK ("monthly_usage_limit_usd_micros" > 0);
