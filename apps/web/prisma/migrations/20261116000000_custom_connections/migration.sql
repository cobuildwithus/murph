CREATE TABLE "hosted_mcp_connection" (
  "id" TEXT PRIMARY KEY,
  "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "server_url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'off' CHECK ("status" IN ('on', 'off', 'needs_sign_in')),
  "auth" TEXT NOT NULL DEFAULT 'none' CHECK ("auth" IN ('none', 'oauth')),
  "generation" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "tools" JSONB NOT NULL DEFAULT '[]',
  "catalog" TEXT NOT NULL,
  "credentials_encrypted" TEXT,
  "token_version" INTEGER NOT NULL DEFAULT 0,
  "refresh_claim" TEXT,
  "refresh_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "hosted_mcp_connection_member_id_slug_key" ON "hosted_mcp_connection"("member_id", "slug");
CREATE TABLE "hosted_mcp_pending_authorization" (
  "connection_id" TEXT PRIMARY KEY REFERENCES "hosted_mcp_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "member_id" TEXT NOT NULL,
  "session_binding" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "state_hash" TEXT NOT NULL,
  "payload_encrypted" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "hosted_mcp_pending_authorization_state_hash_key" ON "hosted_mcp_pending_authorization"("state_hash");
CREATE INDEX "hosted_mcp_pending_authorization_expires_at_idx" ON "hosted_mcp_pending_authorization"("expires_at");
