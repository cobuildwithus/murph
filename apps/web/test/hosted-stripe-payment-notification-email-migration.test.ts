import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260826230000_hosted_stripe_payment_notification_email/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("hosted Stripe payment notification email migration", () => {
  it("adds one nullable receipt-owned sent marker", () => {
    expect(migrationSql.trim()).toBe(
      'ALTER TABLE "hosted_stripe_event"\n  ADD COLUMN "payment_notification_email_sent_at" TIMESTAMP(3);',
    );
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|DELETE|DROP)\b/u);
    expect(schema).toContain(
      'paymentNotificationEmailSentAt DateTime?                    @map("payment_notification_email_sent_at")',
    );
  });
});
