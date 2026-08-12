import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const acceptedInviteMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812032000_family_owner_snapshot_accepted_invite_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const pendingInviteMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812033000_family_owner_snapshot_pending_invite_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const prismaSchema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("Family owner snapshot indexes", () => {
  it("keeps the accepted-invite index matched to the bounded current-member lookup", () => {
    expect(acceptedInviteMigrationSql).toContain(
      '"group_id",\n    "accepted_by_member_id",\n    "created_at",\n    "id"',
    );
    expect(acceptedInviteMigrationSql).toContain('WHERE "status" = \'accepted\'');
    expect(acceptedInviteMigrationSql).toContain(
      'AND "accepted_by_member_id" IS NOT NULL',
    );
    expect(acceptedInviteMigrationSql).toContain("CREATE INDEX CONCURRENTLY");
    expect(acceptedInviteMigrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
  });

  it("matches the active-membership and pending-invite cap reads before LIMIT", () => {
    expect(prismaSchema).toContain("@@index([groupId, status])");
    expect(pendingInviteMigrationSql).toContain(
      '"group_id",\n    "status",\n    "expires_at",\n    "id"',
    );
    expect(pendingInviteMigrationSql).toContain("CREATE INDEX CONCURRENTLY");
    expect(pendingInviteMigrationSql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE)\b/u,
    );
    expect(prismaSchema).toContain(
      '@@index([groupId, status, expiresAt, id], map: "hagi_group_status_expires_id_idx")',
    );
  });
});
