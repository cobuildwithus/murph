ALTER TABLE "device_agent_session"
ADD COLUMN "imessage_renewal_token_hash" TEXT;

CREATE UNIQUE INDEX "device_agent_session_imessage_renewal_token_hash_key"
ON "device_agent_session"("imessage_renewal_token_hash");
