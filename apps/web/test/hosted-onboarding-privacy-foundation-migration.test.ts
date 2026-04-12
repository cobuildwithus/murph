import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const HOSTED_MEMBER_SCHEMA_GUARD = {
  HostedMember: [
    "id String @id",
    'billingStatus HostedBillingStatus @default(not_started) @map("billing_status")',
    'suspendedAt DateTime? @map("suspended_at")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMemberIdentity: [
    'memberId String @unique @map("member_id")',
    'maskedPhoneNumberHint String @map("masked_phone_number_hint")',
    'phoneLookupKey String @unique @map("phone_lookup_key")',
    'phoneNumberEncrypted String? @map("phone_number_encrypted")',
    'phoneNumberVerifiedAt DateTime? @map("phone_number_verified_at")',
    'privyUserLookupKey String? @unique @map("privy_user_lookup_key")',
    'privyUserIdEncrypted String? @map("privy_user_id_encrypted")',
    'walletAddressLookupKey String? @unique @map("wallet_address_lookup_key")',
    'walletAddressEncrypted String? @map("wallet_address_encrypted")',
    'walletChainType String? @map("wallet_chain_type")',
    'walletProvider String? @map("wallet_provider")',
    'walletCreatedAt DateTime? @map("wallet_created_at")',
    'signupPhoneNumberEncrypted String? @map("signup_phone_number_encrypted")',
    'signupPhoneCodeSentAt DateTime? @map("signup_phone_code_sent_at")',
    'signupPhoneCodeSendAttemptId String? @map("signup_phone_code_send_attempt_id")',
    'signupPhoneCodeSendAttemptStartedAt DateTime? @map("signup_phone_code_send_attempt_started_at")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMemberRouting: [
    'memberId String @unique @map("member_id")',
    'linqChatLookupKey String? @unique @map("linq_chat_lookup_key")',
    'linqChatIdEncrypted String? @map("linq_chat_id_encrypted")',
    'linqRecipientPhoneLookupKey String? @map("linq_recipient_phone_lookup_key")',
    'linqRecipientPhoneEncrypted String? @map("linq_recipient_phone_encrypted")',
    'pendingLinqChatLookupKey String? @unique @map("pending_linq_chat_lookup_key")',
    'pendingLinqChatIdEncrypted String? @map("pending_linq_chat_id_encrypted")',
    'pendingLinqRecipientPhoneLookupKey String? @map("pending_linq_recipient_phone_lookup_key")',
    'pendingLinqRecipientPhoneEncrypted String? @map("pending_linq_recipient_phone_encrypted")',
    'telegramUserLookupKey String? @unique @map("telegram_user_lookup_key")',
    'telegramUserIdEncrypted String? @map("telegram_user_id_encrypted")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMemberBillingRef: [
    'memberId String @unique @map("member_id")',
    'stripeCustomerLookupKey String? @unique @map("stripe_customer_lookup_key")',
    'stripeCustomerIdEncrypted String? @map("stripe_customer_id_encrypted")',
    'stripeSubscriptionLookupKey String? @unique @map("stripe_subscription_lookup_key")',
    'stripeSubscriptionIdEncrypted String? @map("stripe_subscription_id_encrypted")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
} as const;

const HOSTED_MEMBER_RELATION_TYPES = new Set([
  "HostedAiUsage",
  "HostedInvite",
  "HostedLinqDailyState",
  "HostedMember",
  "HostedMemberBillingRef",
  "HostedMemberIdentity",
  "HostedMemberRouting",
  "HostedRevnetIssuance",
]);

describe("hosted Prisma baseline migration", () => {
  it("starts from the current split-table hosted-member shape", () => {
    const migrationEntries = readdirSync(new URL("../prisma/migrations/", import.meta.url))
      .filter((entry) => !entry.startsWith("."))
      .sort();
    const baselineMigrationSql = readFileSync(
      new URL("../prisma/migrations/2026040600_init/migration.sql", import.meta.url),
      "utf8",
    );

    expect(migrationEntries).toEqual(["2026040600_init", "migration_lock.toml"]);
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_identity"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_routing"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_billing_ref"');
    expect(baselineMigrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_lookup_key_key"');
    expect(baselineMigrationSql).toContain('"masked_phone_number_hint" TEXT NOT NULL');
    expect(baselineMigrationSql).toContain('"phone_lookup_key" TEXT NOT NULL');
    expect(baselineMigrationSql).toContain('"telegram_user_lookup_key" TEXT');
    expect(baselineMigrationSql).toContain('"payload_json" JSONB NOT NULL');
    expect(baselineMigrationSql).toContain('"result_json" JSONB');
    expect(baselineMigrationSql).toContain('"dispatch_state" TEXT NOT NULL DEFAULT \'queued\'');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_session"');
    expect(baselineMigrationSql).not.toContain('"phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"normalized_phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"telegram_username" TEXT');
    expect(baselineMigrationSql).not.toContain('"webauthn_user_id" TEXT');
    expect(baselineMigrationSql).not.toContain('"email" TEXT');
    expect(baselineMigrationSql).not.toContain('"dispatch_payload_json" JSONB');
    expect(baselineMigrationSql).not.toContain('"linq_chat_id" TEXT');
    expect(baselineMigrationSql).not.toContain('"revnet_amount_paid" INTEGER');
  });

  it("keeps hosted-member models on the reviewed owner-table set", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    expect(readHostedMemberModelNames(schema).sort()).toEqual(
      Object.keys(HOSTED_MEMBER_SCHEMA_GUARD).sort(),
    );
  });

  it("keeps hosted-member data on the reviewed scalar schema contract", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    for (const [modelName, expectedFields] of Object.entries(HOSTED_MEMBER_SCHEMA_GUARD)) {
      expect(
        readPrismaScalarFieldSpecs(schema, modelName).sort(),
        `${modelName} changed. Review the privacy seam explicitly before expanding hosted-member persistence or weakening lookup/encryption metadata.`,
      ).toEqual([...expectedFields].sort());
    }
  });

  it("forbids Json blobs on hosted-member owner tables", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );

    for (const modelName of Object.keys(HOSTED_MEMBER_SCHEMA_GUARD)) {
      const jsonFields = readPrismaScalarFields(schema, modelName)
        .filter(([, type]) => /^Json(?:\[\])?\??$/u.test(type))
        .map(([fieldName]) => fieldName);

      expect(
        jsonFields,
        `${modelName} must stay scalar-only. Add a typed column or a dedicated owner table instead of a catch-all Json blob.`,
      ).toEqual([]);
    }
  });
});

function readHostedMemberModelNames(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(HostedMember\w*)\s+\{/gmu)].map((match) => match[1]);
}

function readPrismaScalarFields(schema: string, modelName: string): Array<[string, string]> {
  return readPrismaModelBlock(schema, modelName)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.match(/^(\w+)\s+([A-Za-z][A-Za-z0-9_\[\]?]*)\b/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => [match[1], match[2]] as [string, string])
    .filter(([, type]) => !type.endsWith("[]") && !HOSTED_MEMBER_RELATION_TYPES.has(type.replace(/\?$/u, "")));
}

function readPrismaScalarFieldSpecs(schema: string, modelName: string): string[] {
  return readPrismaModelBlock(schema, modelName)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0 || line.startsWith("//") || line.startsWith("@@")) {
        return false;
      }
      const match = line.match(/^(\w+)\s+([A-Za-z][A-Za-z0-9_\[\]?]*)\b/u);

      if (!match) {
        return false;
      }
      const type = match[2].replace(/\?$/u, "");

      return !match[2].endsWith("[]") && !HOSTED_MEMBER_RELATION_TYPES.has(type);
    })
    .map((line) => line.replace(/\s+/gu, " ").trim());
}

function readPrismaModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(String.raw`model\s+${modelName}\s+\{[\s\S]*?\n\}`, "u"));

  if (!match) {
    throw new Error(`Expected Prisma model ${modelName} to exist.`);
  }

  return match[0];
}
