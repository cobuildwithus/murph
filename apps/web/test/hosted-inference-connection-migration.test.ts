import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const SCHEMA = readFileSync(
  path.join(WEB_ROOT, "prisma/schema.prisma"),
  "utf8",
);
const MIGRATION = readFileSync(
  path.join(
    WEB_ROOT,
    "prisma/migrations/20260730233000_hosted_inference_connection/migration.sql",
  ),
  "utf8",
);
const REVISION_SEQUENCE_MIGRATION = readFileSync(
  path.join(
    WEB_ROOT,
    "prisma/migrations/20260801010000_hosted_inference_connection_revision_seq/migration.sql",
  ),
  "utf8",
);

describe("hosted inference connection migration", () => {
  it("creates one private encrypted connection per hosted member", () => {
    const model = readPrismaModel(SCHEMA, "HostedInferenceConnection");
    expect(SCHEMA).toContain("model HostedInferenceConnection {");
    expect(model).toContain(
      "memberId            String       @id @map(\"member_id\")",
    );
    expect(model).toContain(
      "configEncrypted     String       @map(\"config_encrypted\")",
    );
    expect(model).not.toContain("endpointUrl");
    expect(model).not.toContain("apiKey");
    expect(model).not.toContain("authSecret");
  });

  it("preserves managed preferences through a singular selection boolean", () => {
    expect(SCHEMA).toContain(
      "selected            Boolean      @default(false)",
    );
    expect(SCHEMA).toContain(
      "assistantProviderPreference    String?",
    );
    expect(SCHEMA).not.toContain("assistantInferenceConnectionId");
  });

  it("enforces protocol, revision, context, and cascading ownership", () => {
    expect(MIGRATION).toContain(
      "CHECK (\"protocol\" IN ('responses', 'chat_completions'))",
    );
    expect(MIGRATION).toContain("CHECK (\"revision\" >= 1)");
    expect(MIGRATION).toContain(
      "CHECK (\"context_window_tokens\" BETWEEN 8192 AND 2000000)",
    );
    expect(MIGRATION).toContain(
      "REFERENCES \"hosted_member\"(\"id\")",
    );
    expect(MIGRATION).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
  });

  it("allocates revisions from a non-reusable sequence seeded past existing rows", () => {
    expect(REVISION_SEQUENCE_MIGRATION).toContain(
      "CREATE SEQUENCE \"hosted_inference_connection_revision_seq\" AS INTEGER",
    );
    expect(REVISION_SEQUENCE_MIGRATION).toContain(
      "SELECT COALESCE(MAX(\"revision\"), 0) + 1 FROM \"hosted_inference_connection\"",
    );
  });
});

function readPrismaModel(schema: string, name: string): string {
  const match = schema.match(
    new RegExp(`model ${name} \\{(?<body>[\\s\\S]*?)\\n\\}`, "u"),
  );
  if (!match?.groups?.body) {
    throw new Error(`Missing Prisma model ${name}.`);
  }
  return match.groups.body;
}
