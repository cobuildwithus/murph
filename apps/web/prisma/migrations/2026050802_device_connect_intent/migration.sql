CREATE TABLE "device_connect_intent" (
    "claim_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connect_source_id" TEXT NOT NULL,
    "connect_target" TEXT NOT NULL,
    "source_provider_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),

    CONSTRAINT "device_connect_intent_pkey" PRIMARY KEY ("claim_hash")
);

CREATE INDEX "device_connect_intent_expires_at_idx" ON "device_connect_intent"("expires_at");
CREATE INDEX "device_connect_intent_member_id_expires_at_idx" ON "device_connect_intent"("member_id", "expires_at");
CREATE INDEX "device_connect_intent_started_at_idx" ON "device_connect_intent"("started_at");
