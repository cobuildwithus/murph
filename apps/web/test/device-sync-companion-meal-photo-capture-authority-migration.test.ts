import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const PRISMA_SCHEMA = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const EXPAND_MIGRATION = readFileSync(
  new URL(
    "../prisma/migrations/20260805230000_meal_photo_authority_revision/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const CONTRACT_MIGRATION = readFileSync(
  new URL(
    "../prisma/contract-migrations/20260805233000_meal_photo_authority_invariants/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("meal photo capture authority migration", () => {
  it("expands the enrollment row without a predeploy validating constraint", () => {
    expect(EXPAND_MIGRATION).toContain(
      'ADD COLUMN "authority_revision" INTEGER DEFAULT 0',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ADD COLUMN "activated_at" TIMESTAMP(3)',
    );
    expect(EXPAND_MIGRATION).not.toContain(
      'ADD COLUMN "authority_revision" INTEGER NOT NULL',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ALTER COLUMN "upload_token_hash" DROP NOT NULL',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ALTER COLUMN "idempotency_secret_encrypted" DROP NOT NULL',
    );
    expect(EXPAND_MIGRATION).toContain(
      'ALTER COLUMN "expires_at" DROP NOT NULL',
    );
    expect(EXPAND_MIGRATION).not.toContain("ADD CONSTRAINT");
  });

  it("models one monotonic revision and nullable tombstone credentials", () => {
    const model = readPrismaModel(
      PRISMA_SCHEMA,
      "HostedMealPhotoCaptureEnrollment",
    );

    expect(model).toContain(
      'authorityRevision          Int          @default(0) @map("authority_revision")',
    );
    expect(model).toContain(
      'uploadTokenHash            String?      @unique @map("upload_token_hash")',
    );
    expect(model).toContain(
      'idempotencySecretEncrypted String?      @map("idempotency_secret_encrypted")',
    );
    expect(model).toContain(
      'expiresAt                  DateTime?    @map("expires_at")',
    );
    expect(model).toContain(
      'activatedAt                DateTime?    @map("activated_at")',
    );
  });

  it("scrubs revoked credentials and validates the post-drain row contract", () => {
    expect(CONTRACT_MIGRATION).toContain(
      'WHERE "revoked_at" IS NOT NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      'WHERE "authority_revision" = 0\n'
      + '  AND "revoked_at" IS NULL\n'
      + '  AND "activated_at" IS NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      'ALTER COLUMN "authority_revision" SET NOT NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      'CHECK ("authority_revision" BETWEEN 0 AND 2147483647) NOT VALID',
    );
    expect(CONTRACT_MIGRATION).toContain(
      '"revoked_at" IS NULL\n        AND "upload_token_hash" IS NOT NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      '"revoked_at" IS NOT NULL\n        AND "upload_token_hash" IS NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      '"authority_revision" > 0\n          OR "activated_at" IS NOT NULL',
    );
    expect(CONTRACT_MIGRATION).toContain(
      'VALIDATE CONSTRAINT "hosted_meal_photo_capture_enrollment_authority_revision_check"',
    );
    expect(CONTRACT_MIGRATION).toContain(
      'VALIDATE CONSTRAINT "hosted_meal_photo_capture_enrollment_credential_shape_check"',
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
