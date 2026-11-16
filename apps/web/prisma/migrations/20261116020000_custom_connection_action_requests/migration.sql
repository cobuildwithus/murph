CREATE TABLE "hosted_mcp_action_request" (
  "id" TEXT PRIMARY KEY,
  "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "connection_id" TEXT NOT NULL REFERENCES "hosted_mcp_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "generation" INTEGER NOT NULL,
  "tool_name" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "lookup_key" TEXT NOT NULL,
  "arguments_encrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting' CHECK ("status" IN ('waiting', 'declined', 'done', 'failed', 'unknown')),
  "result_encrypted" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "decided_at" TIMESTAMP(3),
  CHECK (("status" = 'waiting') = ("decided_at" IS NULL))
);
CREATE INDEX "hosted_mcp_action_request_member_id_lookup_key_idx" ON "hosted_mcp_action_request"("member_id", "lookup_key");
CREATE INDEX "hosted_mcp_action_request_member_id_status_expires_at_idx" ON "hosted_mcp_action_request"("member_id", "status", "expires_at");
CREATE INDEX "hosted_mcp_action_request_connection_id_idx" ON "hosted_mcp_action_request"("connection_id");
CREATE INDEX "hosted_mcp_action_request_created_at_idx" ON "hosted_mcp_action_request"("created_at");
