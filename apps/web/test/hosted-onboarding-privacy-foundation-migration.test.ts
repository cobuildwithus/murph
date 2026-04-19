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
    'maskedPhoneNumberHint String? @map("masked_phone_number_hint")',
    'phoneLookupKey String? @unique @map("phone_lookup_key")',
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
    'replyAliasLookupKey String? @unique @map("reply_alias_lookup_key")',
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
  HostedMemberEmailAuthorization: [
    'memberId String @unique @map("member_id")',
    'verifiedEmailLookupKey String? @unique @map("verified_email_lookup_key")',
    'verifiedEmailAddressEncrypted String? @map("verified_email_address_encrypted")',
    'verifiedEmailVerifiedAt DateTime? @map("verified_email_verified_at")',
    'directPublicSenderLookupKey String? @unique @map("direct_public_sender_lookup_key")',
    'directPublicSenderAddressEncrypted String? @map("direct_public_sender_address_encrypted")',
    'directPublicSenderAuthorizedAt DateTime? @map("direct_public_sender_authorized_at")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
} as const;

const HOSTED_WAKE_RUNTIME_SCHEMA_GUARD = {
  HostedExecutionCursor: [
    'userId String @id @map("user_id")',
    'nextSeq BigInt @default(1) @map("next_seq")',
    'committedSeq BigInt @default(0) @map("committed_seq")',
    'assistantNextWakeAt DateTime? @map("assistant_next_wake_at")',
    'snapshotRef Json? @map("snapshot_ref")',
    'version BigInt @default(0) @map("version")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedWake: [
    "id String @id",
    'userId String @map("user_id")',
    'seq BigInt @map("seq")',
    "kind String",
    "behavior HostedWakeBehavior",
    'dedupeKey String? @map("dedupe_key")',
    'coalescingKey String? @map("coalescing_key")',
    'occurredAt DateTime @map("occurred_at")',
    'payloadSchema String @map("payload_schema")',
    'payloadInlineCiphertext String? @map("payload_inline_ciphertext")',
    'payloadRef String? @map("payload_ref")',
    'payloadBytes Int? @map("payload_bytes")',
    'quarantinedAt DateTime? @map("quarantined_at")',
    'quarantineCode String? @map("quarantine_code")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedWakeEvent: [
    'eventId String @map("event_id")',
    'wakeId String @map("wake_id")',
    'userId String @map("user_id")',
    'replacedByEventId String? @map("replaced_by_event_id")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedWakePayload: [
    'wakeId String @id @map("wake_id")',
    'userId String @map("user_id")',
    'payloadCiphertext String @map("payload_ciphertext")',
    'payloadSchema String @map("payload_schema")',
    'payloadBytes Int @map("payload_bytes")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedWakeTerminal: [
    'wakeId String @id @map("wake_id")',
    'userId String @map("user_id")',
    'wakeSeq BigInt @map("wake_seq")',
    "state String",
    'fetchedCommittedSeq BigInt @map("fetched_committed_seq")',
    'fetchedCursorVersion BigInt @map("fetched_cursor_version")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
} as const;

const HOSTED_WAKE_RUNTIME_MIGRATION_GUARD = {
  hosted_execution_cursor: {
    columns: [
      '"user_id" TEXT NOT NULL',
      '"next_seq" BIGINT NOT NULL DEFAULT 1',
      '"committed_seq" BIGINT NOT NULL DEFAULT 0',
      '"assistant_next_wake_at" TIMESTAMP(3)',
      '"snapshot_ref" JSONB',
      '"version" BIGINT NOT NULL DEFAULT 0',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ],
    constraints: [
      'CONSTRAINT "hosted_execution_cursor_pkey" PRIMARY KEY ("user_id")',
    ],
    indexes: [],
  },
  hosted_wake: {
    columns: [
      '"id" TEXT NOT NULL',
      '"user_id" TEXT NOT NULL',
      '"seq" BIGINT NOT NULL',
      '"kind" TEXT NOT NULL',
      '"behavior" "HostedWakeBehavior" NOT NULL',
      '"dedupe_key" TEXT',
      '"coalescing_key" TEXT',
      '"occurred_at" TIMESTAMP(3) NOT NULL',
      '"payload_schema" TEXT NOT NULL',
      '"payload_inline_ciphertext" TEXT',
      '"payload_ref" TEXT',
      '"payload_bytes" INTEGER',
      '"quarantined_at" TIMESTAMP(3)',
      '"quarantine_code" TEXT',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ],
    constraints: [
      'CONSTRAINT "hosted_wake_pkey" PRIMARY KEY ("id")',
    ],
    indexes: [
      'CREATE INDEX "hosted_wake_user_id_seq_idx" ON "hosted_wake"("user_id", "seq")',
      'CREATE INDEX "hosted_wake_user_id_coalescing_key_seq_idx" ON "hosted_wake"("user_id", "coalescing_key", "seq")',
      'CREATE INDEX "hosted_wake_user_id_kind_seq_idx" ON "hosted_wake"("user_id", "kind", "seq")',
      'CREATE UNIQUE INDEX "hosted_wake_user_id_seq_key" ON "hosted_wake"("user_id", "seq")',
      'CREATE UNIQUE INDEX "hosted_wake_user_id_dedupe_key_key" ON "hosted_wake"("user_id", "dedupe_key")',
    ],
  },
  hosted_wake_event: {
    columns: [
      '"event_id" TEXT NOT NULL',
      '"wake_id" TEXT NOT NULL',
      '"user_id" TEXT NOT NULL',
      '"replaced_by_event_id" TEXT',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ],
    constraints: [
      'CONSTRAINT "hosted_wake_event_pkey" PRIMARY KEY ("user_id","event_id")',
    ],
    indexes: [
      'CREATE INDEX "hosted_wake_event_event_id_idx" ON "hosted_wake_event"("event_id")',
      'CREATE INDEX "hosted_wake_event_user_id_idx" ON "hosted_wake_event"("user_id")',
      'CREATE INDEX "hosted_wake_event_user_id_replaced_by_event_id_idx" ON "hosted_wake_event"("user_id", "replaced_by_event_id")',
      'CREATE INDEX "hosted_wake_event_wake_id_idx" ON "hosted_wake_event"("wake_id")',
    ],
  },
  hosted_wake_payload: {
    columns: [
      '"wake_id" TEXT NOT NULL',
      '"user_id" TEXT NOT NULL',
      '"payload_ciphertext" TEXT NOT NULL',
      '"payload_schema" TEXT NOT NULL',
      '"payload_bytes" INTEGER NOT NULL',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ],
    constraints: [
      'CONSTRAINT "hosted_wake_payload_pkey" PRIMARY KEY ("wake_id")',
    ],
    indexes: [
      'CREATE INDEX "hosted_wake_payload_user_id_idx" ON "hosted_wake_payload"("user_id")',
    ],
  },
  hosted_wake_terminal: {
    columns: [
      '"wake_id" TEXT NOT NULL',
      '"user_id" TEXT NOT NULL',
      '"wake_seq" BIGINT NOT NULL',
      '"state" TEXT NOT NULL',
      '"fetched_committed_seq" BIGINT NOT NULL',
      '"fetched_cursor_version" BIGINT NOT NULL',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updated_at" TIMESTAMP(3) NOT NULL',
    ],
    constraints: [
      'CONSTRAINT "hosted_wake_terminal_pkey" PRIMARY KEY ("wake_id")',
    ],
    indexes: [
      'CREATE INDEX "hosted_wake_terminal_user_id_idx" ON "hosted_wake_terminal"("user_id")',
      'CREATE INDEX "hosted_wake_terminal_user_id_wake_seq_idx" ON "hosted_wake_terminal"("user_id", "wake_seq")',
      'CREATE UNIQUE INDEX "hosted_wake_terminal_user_id_wake_seq_key" ON "hosted_wake_terminal"("user_id", "wake_seq")',
    ],
  },
} as const;

const HOSTED_MEMBER_RELATION_TYPES = new Set([
  "HostedAiUsage",
  "HostedInvite",
  "HostedLinqDailyState",
  "HostedExecutionCursor",
  "HostedMember",
  "HostedMemberBillingRef",
  "HostedMemberEmailAuthorization",
  "HostedMemberIdentity",
  "HostedMemberRouting",
  "HostedRevnetIssuance",
  "HostedWake",
  "HostedWakeEvent",
  "HostedWakePayload",
  "HostedWakeTerminal",
]);

describe("hosted Prisma baseline migration", () => {
  it("preserves the current split-table hosted-member shape in the single checked-in baseline", () => {
    const migrationEntries = readdirSync(new URL("../prisma/migrations/", import.meta.url))
      .filter((entry) => !entry.startsWith("."))
      .sort();
    const baselineMigrationSql = readFileSync(
      new URL("../prisma/migrations/2026040600_init/migration.sql", import.meta.url),
      "utf8",
    );
    expect(migrationEntries).toEqual([
      "2026040600_init",
      "migration_lock.toml",
    ]);
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_identity"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_routing"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_billing_ref"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_email_authorization"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_share_payload"');
    expect(baselineMigrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_lookup_key_key"');
    expect(baselineMigrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_reply_alias_lookup_key_key"');
    expect(baselineMigrationSql).toContain('"assistant_next_wake_at" TIMESTAMP(3)');
    expect(baselineMigrationSql).toContain('"masked_phone_number_hint" TEXT');
    expect(baselineMigrationSql).toContain('"phone_lookup_key" TEXT');
    expect(baselineMigrationSql).not.toContain('"masked_phone_number_hint" TEXT NOT NULL');
    expect(baselineMigrationSql).not.toContain('"phone_lookup_key" TEXT NOT NULL');
    expect(baselineMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_member_email_authorization_verified_email_lookup_key_key"',
    );
    expect(baselineMigrationSql).toContain('"access_token_encrypted" TEXT');
    expect(baselineMigrationSql).toContain('"refresh_token_encrypted" TEXT');
    expect(baselineMigrationSql).toContain(
      'CREATE TABLE "hosted_wake_payload"',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_wake_payload_user_id_idx"',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE TABLE "hosted_execution_cursor"',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE TABLE "hosted_wake"',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_wake_user_id_dedupe_key_key" ON "hosted_wake"("user_id", "dedupe_key")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE TABLE "hosted_wake_event"',
    );
    expect(baselineMigrationSql).toContain(
      'CONSTRAINT "hosted_wake_event_pkey" PRIMARY KEY ("user_id","event_id")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_wake_event_event_id_idx" ON "hosted_wake_event"("event_id")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE TABLE "hosted_wake_terminal"',
    );
    expect(baselineMigrationSql).toContain(
      '"fetched_cursor_version" BIGINT NOT NULL',
    );
    expect(baselineMigrationSql).toContain(
      'FOREIGN KEY ("wake_id") REFERENCES "hosted_wake"("id")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE UNIQUE INDEX "linq_webhook_event_user_id_event_id_key" ON "linq_webhook_event"("user_id", "event_id")',
    );
    expect(baselineMigrationSql).toContain('"telegram_user_lookup_key" TEXT');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_session"');
    expect(baselineMigrationSql).not.toContain('"phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"normalized_phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"telegram_username" TEXT');
    expect(baselineMigrationSql).not.toContain('"webauthn_user_id" TEXT');
    expect(baselineMigrationSql).not.toContain('"email" TEXT');
    expect(baselineMigrationSql).not.toContain('"dispatch_payload_json" JSONB');
    expect(baselineMigrationSql).not.toContain('"linq_chat_id" TEXT');
    expect(baselineMigrationSql).not.toContain('"revnet_amount_paid" INTEGER');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "execution_outbox"');
    expect(baselineMigrationSql).not.toContain('"dispatch_state" TEXT NOT NULL DEFAULT \'queued\'');
    expect(baselineMigrationSql).not.toContain(
      'CREATE INDEX "execution_outbox_next_attempt_at_created_at_idx" ON "execution_outbox"("next_attempt_at", "created_at")',
    );
    expect(baselineMigrationSql).not.toContain('"payload_json" JSONB NOT NULL');
    expect(baselineMigrationSql).not.toContain('"result_json" JSONB');
    expect(baselineMigrationSql).not.toContain('CREATE TYPE "ExecutionOutboxStatus"');
    expect(baselineMigrationSql).not.toContain('"status" "ExecutionOutboxStatus"');
    expect(baselineMigrationSql).not.toContain('"execution_outbox_status_next_attempt_at_created_at_idx"');
    expect(baselineMigrationSql).not.toContain('CREATE TYPE "HostedWebhookReceiptStatus"');
    expect(baselineMigrationSql).not.toContain('CREATE TYPE "HostedWebhookReceiptSideEffectKind"');
    expect(baselineMigrationSql).not.toContain('CREATE TYPE "HostedWebhookReceiptSideEffectStatus"');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_webhook_receipt"');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_webhook_receipt_side_effect"');
    expect(baselineMigrationSql).not.toContain(
      'CREATE INDEX "hosted_webhook_receipt_first_received_at_idx" ON "hosted_webhook_receipt"("first_received_at")',
    );
    expect(baselineMigrationSql).not.toContain(
      'CREATE INDEX "hosted_webhook_receipt_status_claim_expires_at_first_receiv_idx" ON "hosted_webhook_receipt"("status", "claim_expires_at", "first_received_at")',
    );
    expect(baselineMigrationSql).not.toContain(
      'CREATE INDEX "hosted_webhook_receipt_side_effect_source_event_id_status_idx" ON "hosted_webhook_receipt_side_effect"("source", "event_id", "status")',
    );
    expect(baselineMigrationSql).not.toContain(
      'ALTER TABLE "hosted_webhook_receipt_side_effect" ADD CONSTRAINT "hosted_webhook_receipt_side_effect_source_event_id_fkey"',
    );
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

  it("keeps hosted-wake runtime storage aligned between the Prisma schema and baseline migration", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const baselineMigrationSql = readFileSync(
      new URL("../prisma/migrations/2026040600_init/migration.sql", import.meta.url),
      "utf8",
    );

    for (const [modelName, expectedFields] of Object.entries(HOSTED_WAKE_RUNTIME_SCHEMA_GUARD)) {
      expect(
        readPrismaScalarFieldSpecs(schema, modelName).sort(),
        `${modelName} changed. Review hosted-wake runtime persistence explicitly before changing greenfield wake/cursor storage.`,
      ).toEqual([...expectedFields].sort());
    }

    for (const [tableName, guard] of Object.entries(HOSTED_WAKE_RUNTIME_MIGRATION_GUARD)) {
      expect(
        readSqlTableColumns(baselineMigrationSql, tableName),
        `${tableName} column set changed. Review hosted-wake greenfield runtime storage before landing schema drift.`,
      ).toEqual(new Set(guard.columns));
      expect(
        readSqlTableConstraints(baselineMigrationSql, tableName),
        `${tableName} constraint set changed. Review hosted-wake greenfield runtime storage before landing schema drift.`,
      ).toEqual(new Set(guard.constraints));
      expect(
        readSqlTableIndexes(baselineMigrationSql, tableName),
        `${tableName} index set changed. Review hosted-wake greenfield runtime storage before landing schema drift.`,
      ).toEqual(new Set(guard.indexes));
    }
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

function readSqlCreateTableBlock(sql: string, tableName: string): string {
  const match = sql.match(
    new RegExp(String.raw`CREATE TABLE "${tableName}" \(([\s\S]*?)\n\);`, "u"),
  );

  if (!match) {
    throw new Error(`Expected migration table ${tableName} to exist.`);
  }

  return match[0];
}

function readSqlTableColumns(sql: string, tableName: string): Set<string> {
  return new Set(
    readSqlCreateTableBlock(sql, tableName)
      .split("\n")
      .map((line) => line.trim().replace(/,$/u, ""))
      .filter((line) => line.startsWith('"')),
  );
}

function readSqlTableConstraints(sql: string, tableName: string): Set<string> {
  return new Set(
    readSqlCreateTableBlock(sql, tableName)
      .split("\n")
      .map((line) => line.trim().replace(/,$/u, ""))
      .filter((line) => line.startsWith("CONSTRAINT ")),
  );
}

function readSqlTableIndexes(sql: string, tableName: string): Set<string> {
  return new Set(
    [...sql.matchAll(
      new RegExp(
        String.raw`^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "${tableName}"\([^\n]+\);$`,
        "gmu",
      ),
    )]
      .map((match) => match[0].trim().replace(/;$/u, "")),
  );
}
