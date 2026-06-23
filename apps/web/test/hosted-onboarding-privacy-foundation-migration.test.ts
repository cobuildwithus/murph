import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const HOSTED_MEMBER_SCHEMA_GUARD = {
  HostedConnectedAppConnectIntent: [
    'claimHash String @id @map("claim_hash")',
    'memberId String @map("member_id")',
    "toolkit String",
    "alias String?",
    'connectedAccountId String? @map("connected_account_id")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'expiresAt DateTime @map("expires_at")',
    'startedAt DateTime? @map("started_at")',
    'completedAt DateTime? @map("completed_at")',
  ],
  HostedConnectedAppsSession: [
    'memberId String @id @map("member_id")',
    'remoteSessionId String @unique @map("remote_session_id")',
    'policyRevision Int @map("policy_revision")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMember: [
    "id String @id",
    'billingStatus HostedBillingStatus @default(not_started) @map("billing_status")',
    'pendingActivationTimeZone String? @map("pending_activation_time_zone")',
    'signupNotificationEmailAttemptedAt DateTime? @map("signup_notification_email_attempted_at")',
    'signupWelcomeEmailAttemptedAt DateTime? @map("signup_welcome_email_attempted_at")',
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
    'pendingLinqParticipantContactKind String? @map("pending_linq_participant_contact_kind")',
    'pendingLinqParticipantContactLookupKey String? @unique @map("pending_linq_participant_contact_lookup_key")',
    'pendingLinqParticipantContactEncrypted String? @map("pending_linq_participant_contact_encrypted")',
    'pendingLinqParticipantContactObservedAt DateTime? @map("pending_linq_participant_contact_observed_at")',
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
    'stripeSubscriptionScheduleLookupKey String? @unique @map("stripe_subscription_schedule_lookup_key")',
    'stripeSubscriptionScheduleIdEncrypted String? @map("stripe_subscription_schedule_id_encrypted")',
    'lastStripeEventCreatedAt DateTime? @map("last_stripe_event_created_at")',
    'currentBillingPhase String? @map("current_billing_phase")',
    'currentBillingPlanCode String? @map("current_billing_plan_code")',
    'currentCheckoutOffer String? @map("current_checkout_offer")',
    'scheduledBillingPlanCode String? @map("scheduled_billing_plan_code")',
    'scheduledBillingEffectiveAt DateTime? @map("scheduled_billing_effective_at")',
    'currentPeriodStart DateTime? @map("current_period_start")',
    'currentPeriodEnd DateTime? @map("current_period_end")',
    'pulseTrialRedeemedAt DateTime? @map("pulse_trial_redeemed_at")',
    'pulseTrialPolicyVersion String? @map("pulse_trial_policy_version")',
    'currentTrialStartedAt DateTime? @map("current_trial_started_at")',
    'currentTrialEndsAt DateTime? @map("current_trial_ends_at")',
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
    'stripeCheckoutEmailAddressEncrypted String? @map("stripe_checkout_email_address_encrypted")',
    'stripeCheckoutEmailCollectedAt DateTime? @map("stripe_checkout_email_collected_at")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
} as const;

const HOSTED_MEMBER_RELATION_TYPES = new Set([
  "HostedAiUsage",
  // VaultShare v0: consent-grant relation only (grantor/destination back-references).
  // No new scalar member data; share payloads stay on the encrypted mailbox path.
  "HostedVaultShare",
  "HostedAiUsagePeriod",
  "HostedConsentEvent",
  "HostedConsentGrant",
  "HostedInvite",
  "HostedLinqDailyState",
  "HostedConnectedAppConnectIntent",
  "HostedConnectedAppsSession",
  "HostedMember",
  "HostedMemberBillingRef",
  "HostedMemberEmailAuthorization",
  "HostedMemberIdentity",
  "HostedMemberRouting",
  "HostedProductFeedback",
  "HostedWebSession",
  "HostedMailboxItem",
  "HostedMailboxLaneCounter",
  "HostedMailboxPayload",
  "HostedComputerHandoff",
  "HostedComputerRun",
  "HostedRuntimeLog",
  "HostedWorkspace",
  "HostedUserCryptoAudit",
  "HostedUserCryptoEnvelope",
]);

describe("hosted Prisma baseline migration", () => {
  it("preserves the reviewed split-table hosted-member baseline with Stripe hardening squashed in", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const migrationEntries = readdirSync(new URL("../prisma/migrations/", import.meta.url))
      .filter((entry) => !entry.startsWith("."))
      .sort();
    const baselineMigrationSql = readFileSync(
      new URL("../prisma/migrations/2026040600_init/migration.sql", import.meta.url),
      "utf8",
    );
    const legacyLinqDropMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260425000000_drop_legacy_linq_control_plane/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dropRevnetIssuanceMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260425010000_drop_revnet_issuance/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedRuntimeHardCutMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026042700_hosted_runtime_hard_cut/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const dropHostedShareTablesMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260428010000_drop_hosted_share_tables/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLegalConsentMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260429020000_hosted_legal_consent/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceConnectionCredentialsMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050100_device_connection_credentials_setup/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceConnectionSourcesMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050101_device_connection_sources/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAiUsageSanitizedMetadataMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050401_hosted_ai_usage_sanitized_usage_metadata/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceOauthSessionMetadataMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050402_device_oauth_session_metadata/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqPendingParticipantContactMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050403_linq_pending_participant_contact/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const stripeCheckoutEmailMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050501_stripe_checkout_email_authorization/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const pulseTrialCheckoutOfferMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050503_pulse_trial_checkout_offer/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAiUsageLimitNoticeMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026050601_hosted_ai_usage_limit_notice_sent/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAiUsageStripeMeterSkippedMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026051000_hosted_ai_usage_stripe_meter_skipped/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceConnectionDueReconcileSweepIndexMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026051900_device_connection_due_reconcile_sweep_idx/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceConnectionRefreshLeaseMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026052400_device_connection_refresh_lease/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceSyncDirtyPayloadMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026052600_device_sync_dirty_payload/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedIngressLatencyTraceMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026052700_hosted_ingress_latency_trace/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedSignupWelcomeEmailAttemptMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026052800_hosted_signup_welcome_email_attempt/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedSignupNotificationEmailAttemptMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026061500_hosted_signup_notification_email_attempt/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedSubscriptionCancellationEmailSentMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026062101_hosted_subscription_cancellation_email_sent/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLatencyMilestonesMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026060300_hosted_latency_milestones/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAiUsageTokenPricingBasisMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026061500_hosted_ai_usage_token_pricing_basis/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const singleMemberComputerProfileMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026062100_hosted_computer_single_member_profile/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const generalizeProductFeedbackMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260623170000_generalize_hosted_product_feedback/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const productFeedbackSummaryMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260623193000_hosted_product_feedback_summary/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migrationEntries).toEqual([
      "2026040600_init",
      "20260425000000_drop_legacy_linq_control_plane",
      "20260425010000_drop_revnet_issuance",
      "20260426000000_hosted_member_pending_activation_timezone",
      "20260426010000_hosted_mailbox_workspace_groundwork",
      "20260426020000_hosted_mailbox_payload_hash",
      "2026042700_hosted_runtime_hard_cut",
      "20260428010000_drop_hosted_share_tables",
      "20260429020000_hosted_legal_consent",
      "20260501000000_hosted_user_crypto_envelopes",
      "20260501000001_hosted_user_crypto_envelope_hardening",
      "2026050100_device_connection_credentials_setup",
      "2026050101_device_connection_sources",
      "20260502000000_hosted_web_session",
      "2026050400_hosted_ai_usage_provider_request_outcome",
      "2026050401_hosted_ai_usage_sanitized_usage_metadata",
      "2026050402_device_oauth_session_metadata",
      "2026050403_linq_pending_participant_contact",
      "2026050500_device_sync_dirty_connection",
      "2026050501_stripe_checkout_email_authorization",
      "2026050502_hosted_ai_usage_allowance",
      "2026050503_pulse_trial_checkout_offer",
      "2026050601_hosted_ai_usage_limit_notice_sent",
      "2026050602_hosted_plan_switch_schedule_ref",
      "2026050801_device_webhook_trace_claim_token",
      "2026050802_device_connect_intent",
      "2026050900_hosted_web_session_row_cap_index",
      "2026051000_hosted_ai_usage_stripe_meter_skipped",
      "2026051900_device_connection_due_reconcile_sweep_idx",
      "2026052400_device_connection_refresh_lease",
      "2026052600_device_sync_dirty_payload",
      "2026052700_hosted_ingress_latency_trace",
      "2026052700_hosted_runtime_log_event_cooldown_index",
      "2026052800_hosted_signup_welcome_email_attempt",
      "2026060300_hosted_latency_milestones",
      "2026060501_device_sync_source_confirmed_backfill",
      "2026060900_hosted_latency_phase_breakdown",
      "2026061000_hosted_mailbox_consumed_seq",
      "2026061000_hosted_vault_share",
      "2026061001_hosted_ai_usage_turn_profile",
      "2026061500_hosted_ai_usage_token_pricing_basis",
      "2026061500_hosted_signup_notification_email_attempt",
      "2026061700_hosted_computer_use",
      "2026062100_hosted_ai_usage_period_counter_backfill",
      "2026062100_hosted_computer_single_member_profile",
      "2026062101_hosted_subscription_cancellation_email_sent",
      "20260622120000_connected_apps",
      "20260622190000_add_hosted_product_feedback",
      "20260623170000_generalize_hosted_product_feedback",
      "20260623193000_hosted_product_feedback_summary",
      "migration_lock.toml",
    ]);
    expect(schema).not.toContain('profileKey                 String                         @map("profile_key")');
    expect(schema).not.toContain("@@index([memberId, profileKey, updatedAt])");
    expect(singleMemberComputerProfileMigrationSql).toContain(
      'DROP INDEX IF EXISTS "hosted_computer_run_one_active_profile_idx"',
    );
    expect(singleMemberComputerProfileMigrationSql).toContain(
      'DROP INDEX IF EXISTS "hosted_computer_run_member_id_profile_key_updated_at_idx"',
    );
    expect(singleMemberComputerProfileMigrationSql).toContain(
      'DROP COLUMN IF EXISTS "profile_key"',
    );
    expect(singleMemberComputerProfileMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_computer_run_one_active_member_idx"',
    );
    expect(generalizeProductFeedbackMigrationSql).toContain('ADD COLUMN "topic" TEXT');
    expect(generalizeProductFeedbackMigrationSql).not.toContain("NOT NULL");
    expect(generalizeProductFeedbackMigrationSql).not.toContain("feedback_tags_json");
    expect(productFeedbackSummaryMigrationSql).toContain('ADD COLUMN "summary" TEXT');
    expect(productFeedbackSummaryMigrationSql).toContain('DROP COLUMN "topic"');
    expect(productFeedbackSummaryMigrationSql).not.toContain("feedback_tags_json");
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_assistant_runtime_issue"');
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_assistant_runtime_issue_fingerprint_occurred_at_idx"',
    );
    expect(baselineMigrationSql).not.toContain(
      'ALTER TABLE "hosted_assistant_runtime_issue" ADD CONSTRAINT',
    );
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_identity"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_routing"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_billing_ref"');
    expect(baselineMigrationSql).toContain('CREATE TABLE "hosted_member_email_authorization"');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_share_link"');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_share_payload"');
    expect(baselineMigrationSql).not.toContain(["hosted", "vault", "sync"].join("_"));
    expect(baselineMigrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_lookup_key_key"');
    expect(baselineMigrationSql).toContain('CREATE UNIQUE INDEX "hosted_member_routing_reply_alias_lookup_key_key"');
    expect(baselineMigrationSql).toContain('"masked_phone_number_hint" TEXT');
    expect(baselineMigrationSql).toContain('"phone_lookup_key" TEXT');
    expect(baselineMigrationSql).not.toContain('"masked_phone_number_hint" TEXT NOT NULL');
    expect(baselineMigrationSql).not.toContain('"phone_lookup_key" TEXT NOT NULL');
    expect(baselineMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_member_email_authorization_verified_email_lookup_key_key"',
    );
    expect(baselineMigrationSql).toContain('"access_token_encrypted" TEXT');
    expect(baselineMigrationSql).toContain('"refresh_token_encrypted" TEXT');
    expect(baselineMigrationSql).toContain('"last_stripe_event_created_at" TIMESTAMP(3)');
    expect(stripeCheckoutEmailMigrationSql).toContain(
      '"stripe_checkout_email_address_encrypted" TEXT',
    );
    expect(stripeCheckoutEmailMigrationSql).toContain(
      '"stripe_checkout_email_collected_at" TIMESTAMP(3)',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "current_billing_phase" TEXT',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "current_checkout_offer" TEXT',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "pulse_trial_redeemed_at" TIMESTAMP(3)',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "pulse_trial_policy_version" TEXT',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "current_trial_started_at" TIMESTAMP(3)',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).toContain(
      'ADD COLUMN "current_trial_ends_at" TIMESTAMP(3)',
    );
    expect(pulseTrialCheckoutOfferMigrationSql).not.toContain("NOT NULL");
    expect(pulseTrialCheckoutOfferMigrationSql).not.toContain("CREATE INDEX");
    expect(pulseTrialCheckoutOfferMigrationSql).not.toContain("CREATE TYPE");
    expect(pulseTrialCheckoutOfferMigrationSql).not.toContain("launch_trial");
    expect(hostedAiUsageLimitNoticeMigrationSql).toContain(
      'ADD COLUMN "limit_notice_sent_at" TIMESTAMP(3)',
    );
    expect(hostedAiUsageLimitNoticeMigrationSql).toContain(
      'CREATE INDEX "hosted_ai_usage_period_limit_notice_sent_at_idx"',
    );
    expect(hostedAiUsageLimitNoticeMigrationSql).not.toContain("NOT NULL");
    expect(hostedRuntimeHardCutMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_ingress_payload" CASCADE');
    expect(hostedRuntimeHardCutMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_ingress_event_alias" CASCADE');
    expect(hostedRuntimeHardCutMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_ingress_event" CASCADE');
    expect(hostedRuntimeHardCutMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_run" CASCADE');
    expect(hostedRuntimeHardCutMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_execution_cursor" CASCADE');
    expect(hostedRuntimeHardCutMigrationSql).not.toContain(["hosted", "vault", "sync"].join("_"));
    expect(legacyLinqDropMigrationSql).toContain('DROP TABLE IF EXISTS "linq_webhook_event"');
    expect(legacyLinqDropMigrationSql).toContain('DROP TABLE IF EXISTS "linq_recipient_binding"');
    expect(dropRevnetIssuanceMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_revnet_issuance"');
    expect(dropRevnetIssuanceMigrationSql).toContain(
      'DROP TYPE IF EXISTS "HostedRevnetIssuanceStatus"',
    );
    expect(dropHostedShareTablesMigrationSql).toContain(
      'DELETE FROM "hosted_mailbox_item"',
    );
    expect(dropHostedShareTablesMigrationSql).toContain(
      "WHERE \"kind\" = 'vault.share.accepted'",
    );
    expect(dropHostedShareTablesMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_share_payload" CASCADE');
    expect(dropHostedShareTablesMigrationSql).toContain('DROP TABLE IF EXISTS "hosted_share_link" CASCADE');
    expect(hostedLegalConsentMigrationSql).toContain('CREATE TABLE "hosted_consent_event"');
    expect(hostedLegalConsentMigrationSql).toContain('CREATE TABLE "hosted_consent_grant"');
    expect(hostedLegalConsentMigrationSql).toContain(
      'CONSTRAINT "hosted_consent_grant_pkey" PRIMARY KEY ("member_id", "scope")',
    );
    expect(hostedLegalConsentMigrationSql).toContain(
      'CREATE INDEX "hosted_consent_event_member_id_scope_created_at_idx"',
    );
    expect(hostedLegalConsentMigrationSql).toContain(
      'ALTER TABLE "hosted_consent_event" ADD CONSTRAINT "hosted_consent_event_member_id_fkey"',
    );
    expect(deviceConnectionCredentialsMigrationSql).toContain('"credential_kind" TEXT NOT NULL DEFAULT \'oauth_tokens\'');
    expect(deviceConnectionCredentialsMigrationSql).toContain('"provider_config_key" TEXT');
    expect(deviceConnectionCredentialsMigrationSql).toContain('"credential_metadata_json" JSONB');
    expect(deviceConnectionCredentialsMigrationSql).toContain('"setup_phase" TEXT');
    expect(deviceConnectionCredentialsMigrationSql).toContain('"setup_expires_at" TIMESTAMP(3)');
    expect(deviceConnectionCredentialsMigrationSql).toContain(
      'CONSTRAINT "device_connection_credential_kind_check"',
    );
    expect(deviceConnectionCredentialsMigrationSql).toContain(
      'CONSTRAINT "device_connection_setup_phase_check"',
    );
    expect(deviceConnectionCredentialsMigrationSql).toContain(
      'CONSTRAINT "device_connection_credential_material_check"',
    );
    expect(deviceConnectionCredentialsMigrationSql).toContain(
      'CREATE INDEX "device_connection_setup_phase_setup_expires_at_idx"',
    );
    expect(deviceConnectionDueReconcileSweepIndexMigrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "device_connection_due_reconcile_sweep_idx"',
    );
    expect(deviceConnectionDueReconcileSweepIndexMigrationSql).toContain(
      'ON "device_connection"("status", "next_reconcile_at", "updated_at", "id")',
    );
    expect(deviceConnectionDueReconcileSweepIndexMigrationSql).not.toContain("CREATE TABLE");
    expect(deviceConnectionDueReconcileSweepIndexMigrationSql).not.toContain("ALTER TABLE");
    expect(deviceConnectionRefreshLeaseMigrationSql).toContain(
      'ADD COLUMN "refresh_lease_owner" TEXT',
    );
    expect(deviceConnectionRefreshLeaseMigrationSql).toContain(
      'ADD COLUMN "refresh_lease_expires_at" TIMESTAMP(3)',
    );
    expect(deviceConnectionRefreshLeaseMigrationSql).toContain(
      'ADD COLUMN "refresh_lease_token_version" INTEGER',
    );
    expect(deviceConnectionRefreshLeaseMigrationSql).toContain(
      'CONSTRAINT "device_connection_refresh_lease_complete_check"',
    );
    expect(deviceConnectionRefreshLeaseMigrationSql).not.toContain(
      "device_connection_refresh_lease_expires_idx",
    );
    expect(deviceConnectionRefreshLeaseMigrationSql).not.toContain("CREATE TABLE");
    expect(deviceSyncDirtyPayloadMigrationSql).toContain('CREATE TABLE "device_sync_dirty_payload"');
    expect(deviceSyncDirtyPayloadMigrationSql).toContain('"resource_encrypted" TEXT NOT NULL');
    expect(deviceSyncDirtyPayloadMigrationSql).toContain(
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(deviceSyncDirtyPayloadMigrationSql).not.toContain("resource_json");
    expect(deviceSyncDirtyPayloadMigrationSql).toContain(
      'REFERENCES "device_connection"("id")',
    );
    expect(deviceSyncDirtyPayloadMigrationSql).toContain("ON DELETE CASCADE");
    expect(deviceSyncDirtyPayloadMigrationSql).toContain(
      'CREATE INDEX "device_sync_dirty_payload_user_id_connection_id_dirty_revis_idx"',
    );
    expect(hostedIngressLatencyTraceMigrationSql).toContain(
      'CREATE TABLE "hosted_ingress_latency_trace"',
    );
    expect(hostedIngressLatencyTraceMigrationSql).toContain(
      'FOREIGN KEY ("user_id", "mailbox_item_id")',
    );
    expect(hostedIngressLatencyTraceMigrationSql).toContain(
      'REFERENCES "hosted_mailbox_item"("user_id", "id")',
    );
    expect(hostedIngressLatencyTraceMigrationSql).not.toContain(
      'REFERENCES "hosted_member"("id")',
    );
    expect(hostedLatencyMilestonesMigrationSql).toContain(
      'ALTER TABLE "hosted_ingress_latency_trace"',
    );
    expect(hostedLatencyMilestonesMigrationSql).toContain(
      'ADD COLUMN "runner_job_accepted_at" TIMESTAMP(3)',
    );
    expect(hostedLatencyMilestonesMigrationSql).toContain(
      'ADD COLUMN "runtime_phase_started_at" TIMESTAMP(3)',
    );
    expect(hostedLatencyMilestonesMigrationSql).toContain(
      'ADD COLUMN "workspace_restore_done_at" TIMESTAMP(3)',
    );
    expect(hostedLatencyMilestonesMigrationSql).toContain(
      'ADD COLUMN "mailbox_import_done_at" TIMESTAMP(3)',
    );
    expect(hostedAiUsageTokenPricingBasisMigrationSql).toContain(
      'ADD COLUMN "token_pricing_basis" TEXT NOT NULL DEFAULT \'standard\'',
    );
    expect(hostedAiUsageTokenPricingBasisMigrationSql).not.toContain(
      'CREATE INDEX "hosted_ai_usage_token_pricing_basis_occurred_at_idx"',
    );
    expect(hostedSignupWelcomeEmailAttemptMigrationSql).toContain(
      'ADD COLUMN "signup_welcome_email_attempted_at" TIMESTAMP(3)',
    );
    expect(hostedSignupWelcomeEmailAttemptMigrationSql).not.toContain("UPDATE");
    expect(hostedSignupWelcomeEmailAttemptMigrationSql).not.toContain("member.activated");
    expect(hostedSignupWelcomeEmailAttemptMigrationSql).not.toContain("CREATE TABLE");
    expect(hostedSignupWelcomeEmailAttemptMigrationSql).not.toContain("CREATE INDEX");
    expect(hostedSignupNotificationEmailAttemptMigrationSql).toContain(
      'ADD COLUMN "signup_notification_email_attempted_at" TIMESTAMP(3)',
    );
    expect(hostedSignupNotificationEmailAttemptMigrationSql).not.toContain("UPDATE");
    expect(hostedSignupNotificationEmailAttemptMigrationSql).not.toContain("member.activated");
    expect(hostedSignupNotificationEmailAttemptMigrationSql).not.toContain("CREATE TABLE");
    expect(hostedSignupNotificationEmailAttemptMigrationSql).not.toContain("CREATE INDEX");
    expect(hostedSubscriptionCancellationEmailSentMigrationSql).toContain(
      'ADD COLUMN "subscription_cancellation_email_sent_at" TIMESTAMP(3)',
    );
    expect(hostedSubscriptionCancellationEmailSentMigrationSql).not.toContain("UPDATE");
    expect(hostedSubscriptionCancellationEmailSentMigrationSql).not.toContain("CREATE TABLE");
    expect(hostedSubscriptionCancellationEmailSentMigrationSql).not.toContain("CREATE INDEX");
    expect(deviceConnectionSourcesMigrationSql).toContain('CREATE TABLE "device_connection_source"');
    expect(deviceConnectionSourcesMigrationSql).toContain('"source_instance_key" TEXT NOT NULL');
    expect(deviceConnectionSourcesMigrationSql).toContain('"source_provider_slug" TEXT NOT NULL');
    expect(deviceConnectionSourcesMigrationSql).toContain('"resource_availability_summary_json" JSONB');
    expect(deviceConnectionSourcesMigrationSql).toContain(
      'CREATE UNIQUE INDEX "device_connection_source_connection_id_source_instance_key_key"',
    );
    expect(deviceConnectionSourcesMigrationSql).toContain(
      'CREATE INDEX "device_connection_source_list_idx"',
    );
    expect(deviceConnectionSourcesMigrationSql).toContain(
      'CHECK ("status" IN (\'connected\', \'unavailable\', \'error\', \'disconnected\'))',
    );
    expect(deviceConnectionSourcesMigrationSql).toContain(
      'CONSTRAINT "device_connection_source_connection_id_fkey"',
    );
    expect(deviceConnectionSourcesMigrationSql).toContain("ON DELETE CASCADE");
    expect(deviceConnectionSourcesMigrationSql).toContain(
      'CONSTRAINT "device_connection_source_resource_summary_shape_check"',
    );
    expect(hostedAiUsageSanitizedMetadataMigrationSql).toContain(
      'ADD COLUMN "provider_request_id" TEXT',
    );
    expect(hostedAiUsageSanitizedMetadataMigrationSql).toContain(
      'ADD COLUMN "raw_usage_json" JSONB',
    );
    expect(hostedAiUsageSanitizedMetadataMigrationSql).toContain(
      'ADD COLUMN "raw_usage_json_hash" TEXT',
    );
    expect(hostedAiUsageSanitizedMetadataMigrationSql).toContain(
      'ADD COLUMN "usage_extraction_version" TEXT NOT NULL DEFAULT \'legacy\'',
    );
    expect(hostedAiUsageSanitizedMetadataMigrationSql).toContain(
      'ADD COLUMN "usage_extraction_source_path" TEXT',
    );
    expect(deviceOauthSessionMetadataMigrationSql).toContain(
      'ALTER TABLE "device_oauth_session"',
    );
    expect(deviceOauthSessionMetadataMigrationSql).toContain(
      'ADD COLUMN "metadata_json" JSONB',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'ALTER TABLE "hosted_member_routing"',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'ADD COLUMN "pending_linq_participant_contact_kind" TEXT',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'ADD COLUMN "pending_linq_participant_contact_lookup_key" TEXT',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'ADD COLUMN "pending_linq_participant_contact_encrypted" TEXT',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'ADD COLUMN "pending_linq_participant_contact_observed_at" TIMESTAMP(3)',
    );
    expect(linqPendingParticipantContactMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_member_routing_pending_linq_participant_contact_lookup_key_key"',
    );
    expect(baselineMigrationSql).toContain('"feature_key" TEXT');
    expect(baselineMigrationSql).toContain('"surface" TEXT');
    expect(baselineMigrationSql).toContain('"trigger_kind" TEXT');
    expect(baselineMigrationSql).toContain('"reporting_user_id" TEXT');
    expect(baselineMigrationSql).toContain('"gateway_tags_json" JSONB');
    expect(baselineMigrationSql).toContain('"provider_request_ordinal" INTEGER NOT NULL DEFAULT 0');
    expect(baselineMigrationSql).toContain('"stripe_meter_source" TEXT NOT NULL DEFAULT \'murph\'');
    expect(baselineMigrationSql).toContain('"stripe_meter_attempt_count" INTEGER NOT NULL DEFAULT 0');
    expect(baselineMigrationSql).toContain('"stripe_meter_last_attempted_at" TIMESTAMP(3)');
    expect(baselineMigrationSql).toContain('"stripe_meter_next_attempt_at" TIMESTAMP(3)');
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_ai_usage_feature_key_created_at_idx" ON "hosted_ai_usage"("feature_key", "created_at")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_ai_usage_reporting_user_id_created_at_idx" ON "hosted_ai_usage"("reporting_user_id", "created_at")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_ai_usage_surface_created_at_idx" ON "hosted_ai_usage"("surface", "created_at")',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE INDEX "hosted_ai_usage_stripe_meter_due_idx" ON "hosted_ai_usage"("stripe_meter_status", "stripe_meter_next_attempt_at", "occurred_at")',
    );
    expect(schema).toMatch(
      /stripeMeterStatus\s+String\s+@default\("skipped"\)\s+@map\("stripe_meter_status"\)/u,
    );
    expect(hostedAiUsageStripeMeterSkippedMigrationSql).toContain(
      'ALTER TABLE "hosted_ai_usage"',
    );
    expect(hostedAiUsageStripeMeterSkippedMigrationSql).toContain(
      'ALTER COLUMN "stripe_meter_status" SET DEFAULT \'skipped\'',
    );
    expect(hostedAiUsageStripeMeterSkippedMigrationSql).toContain(
      '"stripe_meter_status" IN (\'pending\', \'processing\')',
    );
    expect(baselineMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_ai_usage_turn_attempt_provider_request_idx" ON "hosted_ai_usage"("turn_id", "attempt_count", "provider_request_ordinal")',
    );
    expect(baselineMigrationSql).not.toContain(
      'CREATE UNIQUE INDEX "hosted_ai_usage_turn_id_attempt_count_idx"',
    );
    expect(baselineMigrationSql).not.toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "hosted_ai_usage_turn_id_attempt_count_idx"',
    );
    expect(baselineMigrationSql).toContain('"telegram_user_lookup_key" TEXT');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_session"');
    expect(baselineMigrationSql).not.toContain('"phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"normalized_phone_number" TEXT');
    expect(baselineMigrationSql).not.toContain('"telegram_username" TEXT');
    expect(baselineMigrationSql).not.toContain('"webauthn_user_id" TEXT');
    expect(baselineMigrationSql).not.toContain('"email" TEXT');
    expect(baselineMigrationSql).not.toContain('"dispatch_payload_json" JSONB');
    expect(baselineMigrationSql).not.toContain('"assistant_next_wake_at" TIMESTAMP(3)');
    expect(baselineMigrationSql).not.toContain('CREATE TABLE "hosted_wake_terminal"');
    expect(baselineMigrationSql).not.toContain('"fetched_cursor_version" BIGINT NOT NULL');
    expect(baselineMigrationSql).not.toContain('"linq_chat_id" TEXT');
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
    expect(schema).not.toContain("model HostedRevnetIssuance");
    expect(schema).not.toContain("enum HostedRevnetIssuanceStatus");
  });

  it("makes eligible stuck device connections due even when their reconcile is scheduled in the future", () => {
    const sourceConfirmedBackfillMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026060501_device_sync_source_confirmed_backfill/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sourceConfirmedBackfillMigrationSql).toContain(
      '"setup_phase" = \'source_confirmed\',\n  "setup_expires_at" = NULL',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      'WHERE "status" = \'active\'\n  AND "setup_phase" IN (\'pending_link\', \'link_returned\')',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      '"next_reconcile_at" = LEAST(COALESCE("connection"."next_reconcile_at", NOW()), NOW())',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      'WHERE "connection"."status" = \'active\'',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      '"connection"."last_sync_started_at" IS NULL',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      '"connection"."credential_kind" = \'oauth_tokens\'\n      AND "connection"."access_token_encrypted" IS NOT NULL',
    );
    expect(sourceConfirmedBackfillMigrationSql).toContain(
      '"connection"."credential_kind" = \'provider_config\'\n      AND "connection"."provider_config_key" IS NOT NULL',
    );
    expect(sourceConfirmedBackfillMigrationSql).not.toContain(
      '"credential_kind" = \'none\'',
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
    expect(schema).not.toContain("model LinqRecipientBinding");
    expect(schema).not.toContain("model LinqWebhookEvent");
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
  return [...schema.matchAll(/^model\s+(Hosted(?:ConnectedApp\w*|Member\w*))\s+\{/gmu)]
    .map((match) => match[1]);
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
