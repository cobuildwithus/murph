import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const HOSTED_MEMBER_SCHEMA_GUARD = {
  HostedSensitiveActionChallenge: [
    'tokenHash String @id @map("token_hash")',
    'memberId String @map("member_id")',
    "kind String",
    'bindingHash String @map("binding_hash")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'expiresAt DateTime @map("expires_at")',
    'approvalKey String? @unique @map("approval_key")',
    'actionId String? @map("action_id")',
    'actionHash String? @map("action_hash")',
    'presentationTitle String? @map("presentation_title")',
    'presentationBody String? @map("presentation_body")',
    'approvalStatus HostedSensitiveActionApprovalStatus? @map("approval_status")',
    'decidedAt DateTime? @map("decided_at")',
    'consumedAt DateTime? @map("consumed_at")',
    'consumedBy String? @map("consumed_by")',
    'returnContactKind String? @map("return_contact_kind")',
  ],
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
  HostedMealPhotoCaptureEnrollment: [
    "id String @id",
    'memberId String @map("member_id")',
    'installationIdHash String @map("installation_id_hash")',
    'authorityRevision Int @default(0) @map("authority_revision")',
    'uploadTokenHash String? @unique @map("upload_token_hash")',
    'idempotencySecretEncrypted String? @map("idempotency_secret_encrypted")',
    'expiresAt DateTime? @map("expires_at")',
    'activatedAt DateTime? @map("activated_at")',
    'revokedAt DateTime? @map("revoked_at")',
    'revokeReason String? @map("revoke_reason")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMember: [
    "id String @id",
    'assistantModelPreference String? @map("assistant_model_preference")',
    'assistantProviderPreference String? @map("assistant_provider_preference")',
    'assistantPersona String? @map("assistant_persona")',
    'assistantPersonaCausalSeq BigInt? @map("assistant_persona_causal_seq")',
    'assistantReasoningEffortPreference String? @map("assistant_reasoning_effort_preference")',
    'assistantDetail Int? @map("assistant_detail")',
    'assistantDetailCausalSeq BigInt? @map("assistant_detail_causal_seq")',
    'assistantHumor Int? @map("assistant_humor")',
    'assistantHumorCausalSeq BigInt? @map("assistant_humor_causal_seq")',
    'assistantPush Int? @map("assistant_push")',
    'assistantPushCausalSeq BigInt? @map("assistant_push_causal_seq")',
    'assistantUnhinged Int? @map("assistant_unhinged")',
    'assistantUnhingedCausalSeq BigInt? @map("assistant_unhinged_causal_seq")',
    'assistantTone String? @map("assistant_tone")',
    'assistantToneCausalSeq BigInt? @map("assistant_tone_causal_seq")',
    'assistantVoice String? @map("assistant_voice")',
    'assistantVoiceCausalSeq BigInt? @map("assistant_voice_causal_seq")',
    'billingStatus HostedBillingStatus @default(not_started) @map("billing_status")',
    "codexAuthConnection HostedCodexAuthConnection?",
    "deviceProviderApplications DeviceProviderApplication[]",
    'groupSponsorshipMomentsCreated HostedGroupSponsorshipMoment[] @relation("HostedGroupSponsorshipMomentCreator")',
    'groupSponsorshipsPaid HostedGroupSponsorshipAuthorization[] @relation("HostedGroupSponsorshipAuthorizationPayer")',
    'groupSponsorshipsReceived HostedGroupSponsorshipAuthorization[] @relation("HostedGroupSponsorshipAuthorizationBeneficiary")',
    "inferenceConnection HostedInferenceConnection?",
    'initialOnboardingCompletedAt DateTime? @default(now()) @map("initial_onboarding_completed_at")',
    "linqContactCardShares HostedLinqContactCardShare[]",
    "mealPhotoCaptureEnrollments HostedMealPhotoCaptureEnrollment[]",
    'pendingActivationTimeZone String? @map("pending_activation_time_zone")',
    "pendingGroupSetup HostedPendingGroupSetup?",
    "physicalNotes HostedPhysicalNote[]",
    "sensitiveActionChallenges HostedSensitiveActionChallenge[]",
    'signupNotificationEmailAttemptedAt DateTime? @map("signup_notification_email_attempted_at")',
    'signupWelcomeEmailAttemptedAt DateTime? @map("signup_welcome_email_attempted_at")',
    "subscriptionCheckouts HostedMemberSubscriptionCheckout[]",
    'suspendedAt DateTime? @map("suspended_at")',
    'threadContainerParticipations HostedThreadContainerParticipant[] @relation("HostedThreadContainerParticipantMember")',
    'usageCreditBalanceUsdMicros BigInt? @default(0) @map("usage_credit_balance_usd_micros")',
    "usageCreditEntries HostedUsageCreditEntry[]",
    'usageCreditLedgerVersion BigInt? @default(0) @map("usage_credit_ledger_version")',
    'usageCreditPurchasesPaid HostedUsageCreditPurchase[] @relation("HostedUsageCreditPurchasePayer")',
    'usageCreditPurchasesReceived HostedUsageCreditPurchase[] @relation("HostedUsageCreditPurchaseBeneficiary")',
    'usageReferralsAsBeneficiary HostedUsageReferral[] @relation("HostedUsageReferralBeneficiary")',
    'usageReferralsAsIntroduced HostedUsageReferral[] @relation("HostedUsageReferralIntroducedMember")',
    'usageReferralsAsReferrer HostedUsageReferral[] @relation("HostedUsageReferralReferrer")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedPendingGroupSetup: [
    "id String @id",
    'ownerMemberId String @unique @map("owner_member_id")',
    "channel String",
    'recipientPhoneLookupKey String @map("recipient_phone_lookup_key")',
    'payloadEncrypted String @map("payload_encrypted")',
    'armedAt DateTime @map("armed_at")',
    'expiresAt DateTime @map("expires_at")',
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
    'linqParticipantContactKind String? @map("linq_participant_contact_kind")',
    'linqParticipantContactLookupKey String? @map("linq_participant_contact_lookup_key")',
    'linqRecipientPhoneLookupKey String? @map("linq_recipient_phone_lookup_key")',
    'linqRecipientPhoneEncrypted String? @map("linq_recipient_phone_encrypted")',
    'linqHomeLineAssignedAt DateTime? @map("linq_home_line_assigned_at")',
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
    'stripeCheckoutSessionLookupKey String? @unique @map("stripe_checkout_session_lookup_key")',
    'stripeCheckoutSessionIdEncrypted String? @map("stripe_checkout_session_id_encrypted")',
    'stripeCustomerLookupKey String? @unique @map("stripe_customer_lookup_key")',
    'stripeCustomerIdEncrypted String? @map("stripe_customer_id_encrypted")',
    'stripeSubscriptionLookupKey String? @unique @map("stripe_subscription_lookup_key")',
    'stripeSubscriptionIdEncrypted String? @map("stripe_subscription_id_encrypted")',
    'stripeSubscriptionScheduleLookupKey String? @unique @map("stripe_subscription_schedule_lookup_key")',
    'stripeSubscriptionScheduleIdEncrypted String? @map("stripe_subscription_schedule_id_encrypted")',
    'lastStripeEventCreatedAt DateTime? @map("last_stripe_event_created_at")',
    'usagePlanTransitionAt DateTime? @map("usage_plan_transition_at")',
    'usagePlanTransitionFromCode String? @map("usage_plan_transition_from_code")',
    'usagePlanTransitionKind String? @map("usage_plan_transition_kind")',
    'usagePlanTransitionToCode String? @map("usage_plan_transition_to_code")',
    'currentBillingPhase String? @map("current_billing_phase")',
    'currentBillingPlanCode String? @map("current_billing_plan_code")',
    'currentCheckoutOffer String? @map("current_checkout_offer")',
    'scheduledBillingPlanCode String? @map("scheduled_billing_plan_code")',
    'scheduledBillingEffectiveAt DateTime? @map("scheduled_billing_effective_at")',
    'currentPeriodStart DateTime? @map("current_period_start")',
    'currentPeriodEnd DateTime? @map("current_period_end")',
    'pulseTrialRedeemedAt DateTime? @map("pulse_trial_redeemed_at")',
    'pulseTrialPolicyVersion String? @map("pulse_trial_policy_version")',
    'pulseTrialStartSource String? @map("pulse_trial_start_source")',
    'currentTrialStartedAt DateTime? @map("current_trial_started_at")',
    'currentTrialEndsAt DateTime? @map("current_trial_ends_at")',
    'checkoutAttemptId String? @map("checkout_attempt_id")',
    'checkoutIntentHash String? @map("checkout_intent_hash")',
    'checkoutCreatedAt DateTime? @map("checkout_created_at")',
    'createdAt DateTime @default(now()) @map("created_at")',
    'updatedAt DateTime @updatedAt @map("updated_at")',
  ],
  HostedMemberSubscriptionCheckout: [
    'stripeCheckoutSessionLookupKey String @id @map("stripe_checkout_session_lookup_key")',
    'stripeCheckoutSessionIdEncrypted String @map("stripe_checkout_session_id_encrypted")',
    'memberId String @map("member_id")',
    'createdAt DateTime @default(now()) @map("created_at")',
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
  "ClinicalRecordConnectIntent",
  "ClinicalRecordConnection",
  "ClinicalRecordOauthSession",
  "ClinicalRecordRetrievalRequest",
  "ClinicalRecordRetrievalRun",
  "HostedAiUsage",
  "HostedAddressBookProjection",
  "HostedAccountGroup",
  "HostedAccountGroupBillingRef",
  "HostedAccountGroupInvite",
  "HostedAccountGroupMembership",
  // Generic hosted groups: relation-only back-references from HostedMember.
  // Group membership rows stay in dedicated group tables; optional sharing
  // remains explicit through HostedVaultShare grants.
  "HostedGroup",
  "HostedGroupMember",
  // VaultShare v0: consent-grant relation only (grantor/destination back-references).
  // No new scalar member data; share payloads stay on the encrypted mailbox path.
  "HostedVaultShare",
  "HostedAiUsagePeriod",
  "HostedConsentEvent",
  "HostedConsentGrant",
  "HostedThreadContainer",
  "HostedInvite",
  "HostedLinqDailyState",
  "HostedConnectedAppConnectIntent",
  "HostedConnectedAppsSession",
  "HostedMember",
  "HostedMemberBillingRef",
  "HostedMemberEmailAuthorization",
  "HostedMemberIdentity",
  "HostedMemberRouting",
  "HostedPhoneCall",
  "HostedProductFeedback",
  "HostedWebSession",
  "HostedMailboxItem",
  "HostedMailboxLaneCounter",
  "HostedMailboxPayload",
  "HostedComputerHandoff",
  "HostedComputerRun",
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
    const hostedUserCryptoEnvelopeMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260501000000_hosted_user_crypto_envelopes/migration.sql",
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
    const sensitiveActionChallengeMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260624090000_hosted_sensitive_action_challenge/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedThreadRoutesMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260624120000_hosted_thread_routes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedThreadDeliveryRouteMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260725120000_hosted_thread_delivery_route/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const sensitiveActionApprovalMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260624150000_hosted_sensitive_action_approval/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const actionApprovalReturnContactKindMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260624200000_hosted_action_approval_return_contact_kind/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedPhoneCallsMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260625000100_hosted_phone_calls/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLinqObservabilityMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026062500_hosted_linq_observability/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLinqEgressEngagementMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026062501_hosted_linq_egress_engagement/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const actionApprovalConsumedAtMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260625150000_hosted_action_approval_consumed_at/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const computerHandoffReturnContactKindMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/2026062600_computer_handoff_return_contact_kind/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactAdmissionDecisionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260626000000_linq_first_contact_admission_decision/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactAdmissionBudgetMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260626010000_linq_first_contact_admission_budget/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactAdmissionDropCategoryMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260627210000_linq_first_contact_admission_drop_category/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactRejectedMessageMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260627230000_linq_first_contact_rejected_message_text/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactScrubRejectedMessageMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260628000000_linq_first_contact_scrub_rejected_message_text/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqFirstContactDropRejectedMessageMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260628010000_linq_first_contact_drop_rejected_message_text/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const computerHandoffViewportSessionHintMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260629160000_computer_handoff_viewport_session_hint/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedVaultShareActiveIndexesMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260701153000_hosted_vault_share_active_indexes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceOauthSessionConsumedAtMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260703160000_device_oauth_session_consumed_at/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMailboxItemConsumedAtMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260705120000_hosted_mailbox_item_consumed_at/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedThreadContainerParticipantMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260706120000_hosted_thread_container_participant/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupJoinOfferMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260706130000_hosted_group_join_offer/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupDisclosurePermissionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260716120000_hosted_group_disclosure_permission/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGrowthDailySnapshotMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260706130000_hosted_growth_daily_snapshot/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const staleLinqRecencyDropMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260707170000_drop_stale_linq_recency_columns/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedIngressLatencyDeliveryLinkMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260709120000_hosted_ingress_latency_delivery_link/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLinqDeliveryRetryAfterMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260709120000_hosted_linq_delivery_retry_after_at/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const orphanedHostedLinqInviteDeliveryDeletionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260715120000_delete_orphaned_linq_invite_deliveries/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const orphanedHostedLinqInviteDeliveryContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260715150000_delete_orphaned_linq_invite_deliveries_after_drain/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMemberAssistantModelPreferenceMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260709120000_hosted_member_assistant_model_preference/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMemberAssistantProviderPreferenceMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260729043000_hosted_member_assistant_provider_preference/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMemberAssistantPersonalityMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260710130000_hosted_member_assistant_personality/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMemberAssistantPersonalityContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260713150000_require_assistant_personality_ranges/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAssistantPersonalityProjectionWatermarkMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260715190000_hosted_assistant_personality_projection_watermarks/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAssistantPersonaMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260720173000_hosted_assistant_persona/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMailboxSubscriptionActionClaimMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260715230000_hosted_mailbox_subscription_action_claim/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const linqSignupWelcomeReservationMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260716190000_linq_signup_welcome_reservation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGrowthSnapshotMessageCountsMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260716220000_hosted_growth_snapshot_message_counts/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGrowthSnapshotActiveUsersMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260806120000_hosted_growth_snapshot_active_users/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedAssistantPersonalityProjectionWatermarkContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260715193000_seed_hosted_assistant_personality_projection_watermarks/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedLinqHomeParticipantIdentityMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260711180000_hosted_linq_home_participant_identity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupJoinConfirmationEligibilityMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260711210000_hosted_group_join_confirmation_eligibility/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupJoinConfirmationOriginMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260711220000_hosted_group_join_confirmation_origin/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupJoinConfirmationDrainIndexMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260713190000_hosted_group_join_confirmation_drain_index/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedThreadRouteParticipantAdditionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260713210000_hosted_thread_route_participant_addition/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupReactionContextMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260714120000_hosted_group_reaction_context/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedFamilyMixedTierCapacityMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260714090000_hosted_family_mixed_tier_capacity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedFamilyPendingMemberPlanMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260715150000_hosted_family_pending_member_plan/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedFamilyPlanCodeContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260714150000_require_hosted_family_plan_codes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceSyncCompanionCaptureReceiptMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260712010000_device_sync_companion_capture_receipt/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMailboxCausalSeqMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260712180000_hosted_mailbox_causal_seq/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedMailboxCausalSeqContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260712183000_require_preference_causal_seq/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const assistantPreferenceProjectionWatermarkContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260714120000_seed_assistant_preference_projection_watermarks/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedComputerRunResumeMailboxLaneSeqMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260712190000_hosted_computer_run_resume_mailbox_lane_seq/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedGroupJoinOutreachMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260724190000_hosted_group_join_outreach/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedObservabilityRetentionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260725120000_hosted_observability_retention/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const deviceSyncSignalSourceProviderMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260725193000_device_sync_signal_source_provider/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralEntryKindMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260726115900_hosted_usage_referral_entry_kind/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralRewardsMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260726120000_hosted_usage_referral_rewards/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralCreditEntryContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260726123000_allow_hosted_usage_referral_credit_entries/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralCreditEntryConstraintMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260728030000_hosted_usage_referral_credit_entry_constraints/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralProjectionContractMigrationSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260728031000_resynchronize_hosted_usage_credit_purchase_grants/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedUsageReferralProductSpec = readFileSync(
      new URL(
        "../../../agent-docs/product-specs/hosted-usage-referrals.md",
        import.meta.url,
      ),
      "utf8",
    );
    const normalizedHostedUsageReferralProductSpec =
      hostedUsageReferralProductSpec.replace(/\s+/gu, " ");
    const hostedThreadContainerUsageDefaultMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260726180000_hosted_thread_container_usage_default/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const hostedPendingGroupSetupMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260729124500_hosted_pending_group_setup/migration.sql",
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
      "2026061800_hosted_family_plan",
      "2026062100_hosted_computer_single_member_profile",
      "2026062101_hosted_subscription_cancellation_email_sent",
      "20260622120000_connected_apps",
      "20260622190000_add_hosted_product_feedback",
      "20260623060000_hosted_workspace_inbox_media_retention_wake",
      "20260623120000_hosted_codex_auth_connection",
      "20260623170000_generalize_hosted_product_feedback",
      "20260623193000_hosted_product_feedback_summary",
      "20260624000000_clear_hosted_codex_auth_connected",
      "20260624090000_hosted_sensitive_action_challenge",
      "20260624120000_hosted_thread_routes",
      "20260624150000_hosted_sensitive_action_approval",
      "20260624200000_hosted_action_approval_return_contact_kind",
      "20260624210000_family_invite_telegram_username_lookup",
      "20260624230000_family_invite_email_lookup",
      "20260625000100_hosted_phone_calls",
      "2026062500_hosted_linq_observability",
      "2026062501_hosted_linq_egress_engagement",
      "20260625150000_hosted_action_approval_consumed_at",
      "20260626000000_linq_first_contact_admission_decision",
      "2026062600_computer_handoff_return_contact_kind",
      "20260626010000_linq_first_contact_admission_budget",
      "20260627210000_linq_first_contact_admission_drop_category",
      "20260627230000_hosted_linq_contact_card_share",
      "20260627230000_linq_first_contact_rejected_message_text",
      "20260628000000_linq_first_contact_scrub_rejected_message_text",
      "20260628010000_linq_first_contact_drop_rejected_message_text",
      "20260629160000_computer_handoff_viewport_session_hint",
      "20260630190000_hosted_linq_db_home_lines",
      "20260701040000_hosted_groups",
      "20260701050000_hosted_vault_share_drop_source",
      "20260701153000_hosted_vault_share_active_indexes",
      "20260703160000_device_oauth_session_consumed_at",
      "20260705120000_hosted_mailbox_item_consumed_at",
      "20260706120000_hosted_thread_container_participant",
      "20260706130000_hosted_group_join_offer",
      "20260706130000_hosted_growth_daily_snapshot",
      "20260707170000_drop_stale_linq_recency_columns",
      "20260707180000_hosted_vault_share_projection_scopes",
      "20260708120000_hosted_member_assistant_preferences",
      "20260709120000_hosted_ingress_latency_delivery_link",
      "20260709120000_hosted_linq_delivery_retry_after_at",
      "20260709120000_hosted_member_assistant_model_preference",
      "20260710120000_hosted_member_assistant_reasoning_effort_preference",
      "20260710130000_hosted_member_assistant_personality",
      "20260710160000_clinical_records_control_plane",
      "20260710190000_hosted_phone_call_private_content",
      "20260711180000_hosted_linq_home_participant_identity",
      "20260711210000_hosted_group_join_confirmation_eligibility",
      "20260711220000_hosted_group_join_confirmation_origin",
      "20260712010000_device_sync_companion_capture_receipt",
      "20260712180000_hosted_mailbox_causal_seq",
      "20260712190000_hosted_computer_run_resume_mailbox_lane_seq",
      "20260712190000_hosted_meal_photo_capture_enrollment",
      "20260713190000_hosted_group_join_confirmation_drain_index",
      "20260713210000_hosted_thread_route_participant_addition",
      "20260714060000_add_assistant_preference_projection_watermarks",
      "20260714090000_hosted_family_mixed_tier_capacity",
      "20260714120000_hosted_group_reaction_context",
      "20260714130000_hosted_mailbox_assistant_input_lookup",
      "20260715120000_delete_orphaned_linq_invite_deliveries",
      "20260715150000_hosted_family_pending_member_plan",
      "20260715190000_hosted_assistant_personality_projection_watermarks",
      "20260715230000_hosted_mailbox_subscription_action_claim",
      "20260716120000_hosted_group_disclosure_permission",
      "20260716160000_hosted_usage_credits",
      "20260716190000_linq_signup_welcome_reservation",
      "20260716220000_hosted_growth_snapshot_message_counts",
      "20260718090000_hosted_vault_share_projection_snapshot",
      "20260720150000_clinical_retrieval_plan",
      "20260720173000_hosted_assistant_persona",
      "20260720230000_hosted_group_usage_funding",
      "20260721160000_clinical_retrieval_wire_identity",
      "20260722190000_hosted_phone_call_origin_session",
      "20260723230000_hosted_member_assistant_unhinged",
      "20260724160000_hosted_account_exit_reason",
      "20260724180000_device_connection_source_last_data_at",
      "20260724190000_hosted_group_join_outreach",
      "20260725120000_hosted_observability_retention",
      "20260725120000_hosted_thread_delivery_route",
      "20260725190000_hosted_mailbox_content_retention",
      "20260725193000_device_sync_signal_source_provider",
      "20260725230000_hosted_paid_usage_legacy_period_cutover",
      "20260726115900_hosted_usage_referral_entry_kind",
      "20260726120000_hosted_growth_aggregate",
      "20260726120000_hosted_usage_referral_rewards",
      "20260726124000_hosted_usage_referral_source_conversation",
      "20260726180000_hosted_account_deletion_cleanup",
      "20260726180000_hosted_address_book_projection",
      "20260726180000_hosted_thread_container_usage_default",
      "20260727040000_relax_hosted_usage_credit_detached_direct_proof",
      "20260727120000_hosted_member_checkout_session",
      "20260727190000_hosted_group_sponsorship_moment",
      "20260727200000_hosted_member_checkout_attempt",
      "20260728030000_hosted_invite_instant_start_admission",
      "20260728030000_hosted_usage_referral_credit_entry_constraints",
      "20260728050000_rearm_hosted_mailbox_content_retention",
      "20260728190000_hosted_mailbox_source_message",
      "20260729010000_hosted_account_cleanup_runtime_logs",
      "20260729043000_hosted_member_assistant_provider_preference",
      "20260729124500_hosted_pending_group_setup",
      "20260729154500_hosted_linq_recent_message_load",
      "20260729160000_hosted_linq_delivery_messages",
      "20260729170000_hosted_thread_route_account_lookup_key",
      "20260729180000_linq_provider_health_projection",
      "20260729190000_composable_usage_referral_missions",
      "20260730120000_hosted_capped_group_sponsorship",
      "20260730170000_add_mailbox_ai_usage_denied_at",
      "20260730180000_hosted_linq_delivery_thread_directness",
      "20260730190000_hosted_physical_notes",
      "20260730233000_hosted_inference_connection",
      "20260731001500_add_hosted_product_feedback_created_at_index",
      "20260731120000_anonymize_hosted_product_feedback",
      "20260801010000_hosted_inference_connection_revision_seq",
      "20260802000000_add_hosted_linq_line_inventory_confirmed_at",
      "20260804170000_add_initial_onboarding_completion",
      "20260804223000_hosted_signup_referral_attribution",
      "20260805010000_rearm_generated_image_capture_retention",
      "20260805160000_hosted_usage_plan_reset_epoch",
      "20260805230000_meal_photo_authority_revision",
      "20260806120000_hosted_growth_snapshot_active_users",
      "20260806170000_hosted_pulse_trial_start_source",
      "20260806180000_fix_hosted_usage_plan_transition_bridge",
      "20260807140000_hosted_growth_snapshot_mrr_breakdown",
      "20260807203000_hosted_starter_usage_entry_kind",
      "20260807204000_non_expiring_starter_usage",
      "20260807210000_add_group_sponsorship_creative_request",
      "20260809160000_add_hosted_family_max_plan_code",
      "20260810010000_member_owned_device_provider_applications",
      "20260810050000_relax_detached_automatic_refill_failure",
      "20260810150000_hosted_usage_credit_grant_slot_release",
      "migration_lock.toml",
    ]);
    expect(hostedPendingGroupSetupMigrationSql).toContain(
      'CREATE TABLE "hosted_pending_group_setup"',
    );
    expect(hostedPendingGroupSetupMigrationSql).toContain(
      'ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(hostedPendingGroupSetupMigrationSql).toContain(
      '"payload_encrypted" TEXT NOT NULL',
    );
    expect(hostedPendingGroupSetupMigrationSql).not.toMatch(
      /payload_(?:json|plaintext)|handle|chat_id|participant/iu,
    );
    expect(deviceSyncSignalSourceProviderMigrationSql).toContain(
      'ADD COLUMN "source_provider_slug" TEXT',
    );
    expect(deviceSyncSignalSourceProviderMigrationSql).toContain(
      'CREATE INDEX "device_sync_signal_user_source_idx"',
    );
    expect(hostedUsageReferralEntryKindMigrationSql.trim()).toBe(
      [
        'ALTER TYPE "HostedUsageCreditEntryKind"',
        "  ADD VALUE IF NOT EXISTS 'referral_grant';",
      ].join("\n"),
    );
    expect(
      migrationEntries.indexOf("20260726115900_hosted_usage_referral_entry_kind"),
    ).toBeLessThan(
      migrationEntries.indexOf("20260726120000_hosted_usage_referral_rewards"),
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'CREATE TABLE "hosted_usage_referral"',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'ALTER COLUMN "purchase_id" DROP NOT NULL',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'ADD COLUMN "referral_id" TEXT',
    );
    expect(hostedUsageReferralCreditEntryConstraintMigrationSql).toContain(
      '("purchase_id" IS NOT NULL) <> ("referral_id" IS NOT NULL)',
    );
    expect(hostedUsageReferralRewardsMigrationSql).not.toContain(
      'DROP CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"',
    );
    expect(hostedUsageReferralRewardsMigrationSql).not.toContain(
      'ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"',
    );
    expect(hostedUsageReferralCreditEntryConstraintMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_usage_credit_entry_amount_direction_valid"',
    );
    expect(hostedUsageReferralCreditEntryConstraintMigrationSql).toContain(
      'ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"',
    );
    expect(hostedUsageReferralCreditEntryConstraintMigrationSql).toContain(
      ') NOT VALID',
    );
    expect(hostedUsageReferralCreditEntryConstraintMigrationSql).toContain(
      'VALIDATE CONSTRAINT "hosted_usage_credit_entry_source_shape_valid"',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_usage_credit_entry_referral_grant_key"',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'WHERE "kind" = \'referral_grant\'',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'CREATE TABLE "hosted_usage_credit_grant"',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'PRIMARY KEY ("entry_id")',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'CHECK ("remaining_usd_micros" >= 0)',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      'FOREIGN KEY ("entry_id") REFERENCES "hosted_usage_credit_entry"("id")',
    );
    expect(hostedUsageReferralRewardsMigrationSql).toContain(
      [
        'INNER JOIN "hosted_usage_credit_purchase" AS purchase',
        '  ON purchase."id" = entry."purchase_id"',
        "WHERE entry.\"kind\" = 'purchase_grant';",
      ].join("\n"),
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).toContain(
      'ON CONFLICT ("entry_id") DO UPDATE',
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).toContain(
      '"remaining_usd_micros" = EXCLUDED."remaining_usd_micros"',
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).toContain(
      'SELECT COUNT(*) AS "lockedBeneficiaryCount"',
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).toContain(
      'ORDER BY member."id"\n  FOR UPDATE',
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).toContain(
      'IS DISTINCT FROM purchase."remaining_credit_usd_micros"',
    );
    expect(hostedUsageReferralProjectionContractMigrationSql).not.toContain(
      'ALTER TABLE "hosted_usage_credit_entry"',
    );
    expect(hostedUsageReferralCreditEntryContractMigrationSql).toContain(
      'ALTER TABLE "hosted_usage_credit_entry"',
    );
    expect(hostedUsageReferralProductSpec).not.toContain(
      "20260726123000_allow_hosted_usage_referral_credit_entries",
    );
    expect(normalizedHostedUsageReferralProductSpec.indexOf(
      "20260728030000_hosted_usage_referral_credit_entry_constraints",
    )).toBeLessThan(normalizedHostedUsageReferralProductSpec.indexOf(
      "previous Vercel function window to drain",
    ));
    expect(normalizedHostedUsageReferralProductSpec.indexOf(
      "previous Vercel function window to drain",
    )).toBeLessThan(normalizedHostedUsageReferralProductSpec.indexOf(
      "20260728031000_resynchronize_hosted_usage_credit_purchase_grants",
    ));
    expect(normalizedHostedUsageReferralProductSpec.indexOf(
      "20260728031000_resynchronize_hosted_usage_credit_purchase_grants",
    )).toBeLessThan(normalizedHostedUsageReferralProductSpec.indexOf(
      "Enable `HOSTED_USAGE_REFERRALS_ENABLED=1`",
    ));
    expect(hostedUsageReferralRewardsMigrationSql).not.toContain(
      "hosted_usage_credit_allocation",
    );
    expect(hostedUsageReferralRewardsMigrationSql).not.toContain(
      "HostedUsageCreditGrantKind",
    );
    expect(hostedUsageReferralRewardsMigrationSql).not.toMatch(
      /phone|email|telegram|chat_id/iu,
    );
    expect(hostedUserCryptoEnvelopeMigrationSql).toContain(
      "CREATE UNIQUE INDEX hosted_user_crypto_envelope_one_active_per_domain_idx",
    );
    expect(hostedUserCryptoEnvelopeMigrationSql).toMatch(
      /ON hosted_user_crypto_envelope\(user_id, domain\)\s+WHERE status = 'active'/u,
    );
    expect(schema).toContain(
      'monthlyUsageLimitUsdMicros BigInt              @default(7500000) @map("monthly_usage_limit_usd_micros")',
    );
    expect(hostedThreadContainerUsageDefaultMigrationSql.trim()).toBe(
      [
        'ALTER TABLE "hosted_thread_container"',
        'ALTER COLUMN "monthly_usage_limit_usd_micros" SET DEFAULT 7500000;',
      ].join("\n"),
    );
    expect(hostedThreadContainerUsageDefaultMigrationSql).not.toMatch(/\bUPDATE\b/u);
    expect(hostedMailboxSubscriptionActionClaimMigrationSql).toContain(
      'ALTER TABLE "hosted_mailbox_item"',
    );
    expect(hostedObservabilityRetentionMigrationSql).toContain(
      [
        'ALTER TABLE "hosted_workspace"',
        'ADD COLUMN "accepted_attempt_failure_recheck_claimed_at" TIMESTAMP(3);',
      ].join("\n"),
    );
    for (const [indexName, tableName, orderedColumns] of [
      ["hosted_runtime_log_at_id_idx", "hosted_runtime_log", '"at", "id"'],
      [
        "hosted_ingress_latency_trace_accepted_at_id_idx",
        "hosted_ingress_latency_trace",
        '"accepted_at", "id"',
      ],
      [
        "hosted_linq_provider_event_received_at_event_id_idx",
        "hosted_linq_provider_event",
        '"received_at", "event_id"',
      ],
      [
        "hosted_mailbox_item_expires_at_id_idx",
        "hosted_mailbox_item",
        '"expires_at", "id"',
      ],
      [
        "hosted_mailbox_item_created_at_id_idx",
        "hosted_mailbox_item",
        '"created_at", "id"',
      ],
      [
        "hosted_web_session_expires_at_id_idx",
        "hosted_web_session",
        '"expires_at", "id"',
      ],
      [
        "hosted_web_session_revoked_at_id_idx",
        "hosted_web_session",
        '"revoked_at", "id"',
      ],
    ] as const) {
      expect(hostedObservabilityRetentionMigrationSql).toContain(
        [
          `CREATE INDEX CONCURRENTLY "${indexName}"`,
          `ON "${tableName}"(${orderedColumns});`,
        ].join("\n"),
      );
    }
    expect(hostedObservabilityRetentionMigrationSql).not.toMatch(
      /CREATE INDEX "(?:hosted_runtime_log|hosted_ingress_latency_trace|hosted_linq_provider_event|hosted_mailbox_item|hosted_web_session)/u,
    );
    expect(hostedMailboxSubscriptionActionClaimMigrationSql).toContain(
      'ADD COLUMN "subscription_action_claim" TEXT',
    );
    expect(linqSignupWelcomeReservationMigrationSql).toContain(
      'ADD COLUMN "proactive_conversation_day_utc" DATE',
    );
    expect(linqSignupWelcomeReservationMigrationSql).toContain(
      'ADD COLUMN "proactive_conversation_count" INTEGER',
    );
    expect(linqSignupWelcomeReservationMigrationSql).not.toContain("UPDATE");
    expect(hostedGrowthSnapshotMessageCountsMigrationSql).toContain(
      'ALTER TABLE "hosted_growth_daily_snapshot"',
    );
    expect(hostedGrowthSnapshotMessageCountsMigrationSql).toContain(
      'ADD COLUMN "inbound_messages_prior_day" INTEGER',
    );
    expect(hostedGrowthSnapshotMessageCountsMigrationSql).toContain(
      'ADD COLUMN "outbound_messages_prior_day" INTEGER',
    );
    expect(hostedGrowthSnapshotMessageCountsMigrationSql).not.toContain("UPDATE");
    expect(hostedGrowthSnapshotActiveUsersMigrationSql).toContain(
      'ALTER TABLE "hosted_growth_daily_snapshot"',
    );
    expect(hostedGrowthSnapshotActiveUsersMigrationSql).toContain(
      'ADD COLUMN "active_users_prior_day" INTEGER',
    );
    expect(hostedGrowthSnapshotActiveUsersMigrationSql).toContain(
      'ADD COLUMN "active_users_trailing_7_days" INTEGER',
    );
    expect(hostedGrowthSnapshotActiveUsersMigrationSql).not.toContain("UPDATE");
    expect(hostedFamilyMixedTierCapacityMigrationSql).toContain(
      'ADD COLUMN "plan_code" TEXT DEFAULT \'pulse\'',
    );
    expect(hostedFamilyMixedTierCapacityMigrationSql).toContain(
      'CREATE TABLE "hosted_account_group_plan_capacity"',
    );
    expect(hostedFamilyMixedTierCapacityMigrationSql).toContain(
      'CHECK ("plan_code" IN (\'pulse\', \'edge\'))',
    );
    expect(hostedFamilyPlanCodeContractMigrationSql).toContain(
      'WHERE "plan_code" IS NULL',
    );
    expect(hostedFamilyPlanCodeContractMigrationSql).toContain(
      'ALTER COLUMN "plan_code" SET NOT NULL',
    );
    expect(hostedFamilyPlanCodeContractMigrationSql).toContain(
      'VALIDATE CONSTRAINT "hosted_account_group_membership_plan_code_check"',
    );
    expect(hostedFamilyMixedTierCapacityMigrationSql).not.toContain(
      'INSERT INTO "hosted_account_group_plan_capacity"',
    );
    expect(hostedFamilyPendingMemberPlanMigrationSql).toContain(
      'ADD COLUMN "pending_plan_code" TEXT',
    );
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).toContain(
      'ALTER TABLE "hosted_group_member"',
    );
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).toContain(
      'ADD COLUMN "join_confirmation_eligible_at" TIMESTAMP(3)',
    );
    expect(hostedGroupJoinConfirmationOriginMigrationSql).toContain(
      'ALTER TABLE "hosted_group_member"',
    );
    expect(hostedGroupJoinConfirmationOriginMigrationSql).toContain(
      'ADD COLUMN "join_confirmation_origin" TEXT',
    );
    expect(hostedGroupJoinConfirmationDrainIndexMigrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_group_member_join_confirmation_drain_idx"',
    );
    expect(hostedGroupJoinConfirmationDrainIndexMigrationSql).toContain(
      'ON "hosted_group_member"("created_at", "id")',
    );
    expect(hostedGroupJoinConfirmationDrainIndexMigrationSql).toContain(
      'WHERE "join_confirmation_eligible_at" IS NOT NULL',
    );
    expect(hostedGroupJoinConfirmationDrainIndexMigrationSql).toContain(
      'AND "role" = \'member\'',
    );
    expect(hostedGroupJoinConfirmationDrainIndexMigrationSql).not.toContain("ALTER TABLE");
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).toContain(
      'CREATE TRIGGER "hosted_group_join_confirmation_eligibility_bridge"',
    );
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).toContain(
      'NEW."role" = \'member\'',
    );
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).toContain(
      'AND "join_code" IS NOT NULL',
    );
    expect(hostedGroupJoinConfirmationEligibilityMigrationSql).not.toMatch(
      /UPDATE\s+"hosted_group_member"/u,
    );
    expect(hostedLinqHomeParticipantIdentityMigrationSql).toContain(
      'CREATE TRIGGER "hosted_linq_home_participant_clear_bridge"',
    );
    expect(hostedLinqHomeParticipantIdentityMigrationSql).toContain(
      'IF NEW."linq_chat_lookup_key" IS NULL THEN',
    );
    expect(hostedLinqHomeParticipantIdentityMigrationSql).toContain(
      'NEW."linq_participant_contact_lookup_key" = NULL',
    );
    expect(schema).toMatch(
      /joinConfirmationEligibleAt\s+DateTime\?\s+@map\("join_confirmation_eligible_at"\)/u,
    );
    expect(schema).toMatch(
      /joinConfirmationOrigin\s+String\?\s+@map\("join_confirmation_origin"\)/u,
    );
    for (const setting of ["humor", "push", "detail"]) {
      expect(hostedMemberAssistantPersonalityMigrationSql).toContain(
        `ADD COLUMN "assistant_${setting}" INTEGER`,
      );
      expect(hostedMemberAssistantPersonalityMigrationSql).not.toContain(
        `CONSTRAINT "hosted_member_assistant_${setting}_range"`,
      );
      expect(hostedMemberAssistantPersonalityMigrationSql).not.toContain(
        `CHECK ("assistant_${setting}" BETWEEN 0 AND 10)`,
      );
      expect(hostedMemberAssistantPersonalityContractMigrationSql).toContain(
        `CONSTRAINT "hosted_member_assistant_${setting}_range"`,
      );
      expect(hostedMemberAssistantPersonalityContractMigrationSql).toContain(
        `CHECK ("assistant_${setting}" BETWEEN 0 AND 10)`,
      );
      expect(hostedMemberAssistantPersonalityContractMigrationSql).toContain(
        `"assistant_${setting}" NOT BETWEEN 0 AND 10`,
      );
      expect(hostedAssistantPersonalityProjectionWatermarkMigrationSql).toContain(
        `ADD COLUMN "assistant_${setting}_causal_seq" BIGINT`,
      );
      expect(hostedAssistantPersonalityProjectionWatermarkContractMigrationSql).toContain(
        `"assistant_${setting}_causal_seq" = GREATEST(`,
      );
      expect(hostedAssistantPersonalityProjectionWatermarkContractMigrationSql).toContain(
        `COALESCE(member."assistant_${setting}_causal_seq", 0)`,
      );
    }
    expect(hostedAssistantPersonalityProjectionWatermarkMigrationSql).not.toContain("UPDATE");
    expect(hostedAssistantPersonaMigrationSql).toContain(
      'ADD COLUMN "assistant_persona" TEXT',
    );
    expect(hostedAssistantPersonaMigrationSql).toContain(
      'ADD COLUMN "assistant_persona_causal_seq" BIGINT',
    );
    expect(hostedAssistantPersonaMigrationSql).not.toContain("UPDATE");
    expect(hostedAssistantPersonalityProjectionWatermarkContractMigrationSql).toContain(
      'FROM "hosted_mailbox_lane_counter" AS causal_counter',
    );
    expect(hostedAssistantPersonalityProjectionWatermarkContractMigrationSql).toContain(
      'COALESCE(causal_counter."next_seq" - 1, 0)',
    );
    expect(hostedAssistantPersonalityProjectionWatermarkContractMigrationSql).toContain(
      "causal_counter.\"lane\" = 'causal'",
    );
    expect(hostedMemberAssistantPersonalityContractMigrationSql).toContain(
      "IF EXISTS",
    );
    expect(hostedComputerRunResumeMailboxLaneSeqMigrationSql).toContain(
      'ADD COLUMN "resume_after_mailbox_lane_seq" BIGINT',
    );
    expect(schema).toContain(
      'resumeAfterMailboxLaneSeq  BigInt?                        @map("resume_after_mailbox_lane_seq")',
    );
    expect(hostedThreadRoutesMigrationSql).toContain('CREATE TABLE "hosted_thread_container"');
    expect(hostedThreadRoutesMigrationSql).toContain('CREATE TABLE "hosted_thread_route"');
    expect(hostedThreadRoutesMigrationSql).toContain(
      'PRIMARY KEY ("channel", "thread_identity_lookup_key")',
    );
    expect(hostedThreadRoutesMigrationSql).toContain('"thread_lookup_key" TEXT NOT NULL');
    expect(hostedThreadRoutesMigrationSql).toContain(
      '"thread_identity_lookup_key" TEXT NOT NULL',
    );
    expect(hostedThreadRoutesMigrationSql).toContain(
      '"hosted_thread_route_channel_thread_lookup_key_idx"',
    );
    expect(hostedThreadRoutesMigrationSql).toContain('"owner_member_id" TEXT NOT NULL');
    expect(hostedThreadRoutesMigrationSql).toContain('"monthly_usage_limit_usd_micros" BIGINT NOT NULL DEFAULT 4500000');
    expect(hostedThreadRoutesMigrationSql).toContain('REFERENCES "hosted_thread_container"("member_id")');
    expect(hostedThreadRoutesMigrationSql).toContain(
      'REFERENCES "hosted_member"("id")\n  ON DELETE CASCADE',
    );
    expect(hostedThreadRoutesMigrationSql).toContain(
      'CONSTRAINT "hosted_thread_container_owner_member_id_fkey"',
    );
    expect(hostedThreadRoutesMigrationSql).toContain("ON DELETE RESTRICT");
    expect(hostedThreadRoutesMigrationSql).not.toContain("group_chat");
    expect(hostedThreadRoutesMigrationSql).not.toContain("linq_group");
    expect(hostedThreadRoutesMigrationSql).not.toContain("thread_id_encrypted");
    expect(hostedThreadRoutesMigrationSql).not.toContain('"source"');
    expect(hostedThreadRoutesMigrationSql).not.toContain('"status"');
    expect(hostedThreadDeliveryRouteMigrationSql).toContain(
      'ADD COLUMN "delivery_route_encrypted" TEXT',
    );
    expect(hostedThreadDeliveryRouteMigrationSql).not.toContain("NOT NULL");
    expect(schema).toMatch(
      /deliveryRouteEncrypted\s+String\?\s+@map\("delivery_route_encrypted"\)/u,
    );
    expect(schema).not.toMatch(/deliveryRoute\s+String/u);
    expect(hostedThreadRouteParticipantAdditionMigrationSql).toContain(
      'ADD COLUMN "pending_participant_addition" BOOLEAN DEFAULT false',
    );
    expect(hostedThreadRouteParticipantAdditionMigrationSql).not.toContain(
      "NOT NULL",
    );
    expect(schema).toMatch(
      /pendingParticipantAddition\s+Boolean\?\s+@default\(false\)\s+@map\("pending_participant_addition"\)/u,
    );
    expect(hostedGroupReactionContextMigrationSql).toContain(
      'ADD COLUMN "pending_group_reaction_context_encrypted" TEXT',
    );
    expect(hostedGroupReactionContextMigrationSql).not.toContain("NOT NULL");
    expect(hostedGroupReactionContextMigrationSql).not.toContain(
      '"pending_group_reaction_context"',
    );
    expect(schema).toMatch(
      /pendingGroupReactionContextEncrypted\s+String\?\s+@map\("pending_group_reaction_context_encrypted"\)/u,
    );
    expect(schema).not.toMatch(/pendingGroupReactionContext\s+String/u);
    expect(hostedThreadContainerParticipantMigrationSql).toContain(
      'CREATE TABLE "hosted_thread_container_participant"',
    );
    expect(hostedThreadContainerParticipantMigrationSql).toContain(
      '"handle_lookup_key" TEXT NOT NULL',
    );
    expect(hostedThreadContainerParticipantMigrationSql).toContain(
      'PRIMARY KEY ("container_member_id", "participant_member_id")',
    );
    expect(hostedThreadContainerParticipantMigrationSql).toContain(
      'REFERENCES "hosted_thread_container"("member_id") ON DELETE CASCADE',
    );
    expect(hostedThreadContainerParticipantMigrationSql).toContain(
      'REFERENCES "hosted_member"("id") ON DELETE CASCADE',
    );
    expect(hostedThreadContainerParticipantMigrationSql).not.toContain('"handle" TEXT');
    expect(hostedThreadContainerParticipantMigrationSql).not.toMatch(
      /"(?:raw_)?(?:message|body|payload)[^"]*"/iu,
    );
    expect(hostedGroupJoinOfferMigrationSql).toContain(
      'CREATE TABLE "hosted_group_join_offer"',
    );
    expect(hostedGroupJoinOfferMigrationSql).toContain('"message_lookup_key" TEXT NOT NULL');
    expect(hostedGroupJoinOfferMigrationSql).toContain('"projection_kinds_json" JSONB NOT NULL');
    expect(hostedGroupJoinOfferMigrationSql).toContain('"revoked_at" TIMESTAMP(3)');
    expect(hostedGroupJoinOfferMigrationSql).toContain(
      'REFERENCES "hosted_group"("id")',
    );
    expect(hostedGroupJoinOfferMigrationSql).not.toContain(
      'ALTER TABLE "hosted_group"',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'CREATE TABLE "hosted_group_join_outreach"',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      '"participant_phone_lookup_key" TEXT NOT NULL',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      '"participant_phone_encrypted" TEXT NOT NULL',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'hosted_group_join_outreach_offer_participant_key',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'REFERENCES "hosted_group_join_offer"("id")',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'ADD COLUMN "group_join_outreach_id" TEXT',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'ADD COLUMN "group_join_reply_occurred_at" TIMESTAMP(3)',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'ADD COLUMN "group_join_offer_handled_at" TIMESTAMP(3)',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'REFERENCES "hosted_group_join_outreach"("id")',
    );
    expect(hostedGroupJoinOutreachMigrationSql).toContain(
      'hosted_linq_delivery_group_join_outreach_status_idx',
    );
    expect(hostedGroupJoinOutreachMigrationSql).not.toContain(
      '"participant_phone_number"',
    );
    expect(hostedGroupJoinOutreachMigrationSql).not.toContain(
      'REFERENCES "hosted_linq_line"("phone_number_lookup_key")',
    );
    for (const sql of [
      'CREATE TABLE "hosted_group_disclosure_permission"',
      '"permission_text_encrypted" TEXT NOT NULL',
      'CREATE TABLE "hosted_group_disclosure_grant"',
      'WHERE "revoked_at" IS NULL',
      'REFERENCES "hosted_group"("id") ON DELETE CASCADE',
      'REFERENCES "hosted_group_member"("id") ON DELETE CASCADE',
    ]) expect(hostedGroupDisclosurePermissionMigrationSql).toContain(sql);
    expect(hostedGroupDisclosurePermissionMigrationSql).not.toContain(
      '"permission_text" TEXT',
    );
    expect(hostedGroupDisclosurePermissionMigrationSql).not.toMatch(
      /"(?:question|answer|candidate|response|vault)[^"]*"/iu,
    );
    expect(hostedGrowthDailySnapshotMigrationSql).toContain(
      'CREATE TABLE "hosted_growth_daily_snapshot"',
    );
    expect(hostedGrowthDailySnapshotMigrationSql).toContain(
      '"snapshot_date" DATE NOT NULL',
    );
    expect(hostedGrowthDailySnapshotMigrationSql).toContain(
      'PRIMARY KEY ("snapshot_date")',
    );
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
    expect(hostedPhoneCallsMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_phone_call_member_id_request_key_key" ON "hosted_phone_call"("member_id", "request_key")',
    );
    expect(hostedPhoneCallsMigrationSql).toContain(
      'REFERENCES "hosted_member"("id") ON DELETE CASCADE',
    );
    expect(hostedPhoneCallsMigrationSql).not.toMatch(/transcript|audio/iu);
    expect(productFeedbackSummaryMigrationSql).toContain('ADD COLUMN "summary" TEXT');
    expect(productFeedbackSummaryMigrationSql).toContain('DROP COLUMN "topic"');
    expect(productFeedbackSummaryMigrationSql).not.toContain("feedback_tags_json");
    expect(sensitiveActionChallengeMigrationSql).toContain(
      'CREATE TABLE "hosted_sensitive_action_challenge"',
    );
    expect(sensitiveActionChallengeMigrationSql).toContain(
      'PRIMARY KEY ("token_hash")',
    );
    expect(sensitiveActionChallengeMigrationSql).toContain(
      'REFERENCES "hosted_member"("id") ON DELETE CASCADE',
    );
    expect(sensitiveActionChallengeMigrationSql).not.toContain("signature");
    expect(sensitiveActionChallengeMigrationSql).not.toContain("wallet_address");
    expect(sensitiveActionChallengeMigrationSql).not.toContain("approved_at");
    expect(sensitiveActionApprovalMigrationSql).toContain(
      'ADD COLUMN "approval_key" TEXT',
    );
    expect(sensitiveActionApprovalMigrationSql).toContain(
      'CREATE INDEX "hosted_sensitive_action_approval_member_status_due_idx"',
    );
    expect(sensitiveActionApprovalMigrationSql).toContain(
      '"kind" = \'assistant.action.approve\'',
    );
    expect(sensitiveActionApprovalMigrationSql).not.toContain("signature");
    expect(sensitiveActionApprovalMigrationSql).not.toContain("wallet_address");
    expect(actionApprovalReturnContactKindMigrationSql).toContain(
      'ADD COLUMN "return_contact_kind" TEXT',
    );
    expect(hostedLinqObservabilityMigrationSql).toContain('CREATE TABLE "hosted_linq_line"');
    expect(hostedLinqObservabilityMigrationSql).toContain('CREATE TABLE "hosted_linq_provider_event"');
    expect(hostedLinqObservabilityMigrationSql).toContain('CREATE TABLE "hosted_linq_delivery"');
    expect(hostedLinqObservabilityMigrationSql).toContain('CREATE TABLE "hosted_linq_alert"');
    expect(hostedLinqObservabilityMigrationSql).toContain('"payload_shape_json" JSONB');
    expect(hostedLinqObservabilityMigrationSql).toContain('"payload_sanitized_json" JSONB');
    expect(hostedLinqObservabilityMigrationSql).toContain('"provider_created_at" TIMESTAMP(3) NOT NULL');
    expect(hostedLinqObservabilityMigrationSql).not.toContain('"phone_number" TEXT NOT NULL');
    expect(hostedLinqObservabilityMigrationSql).not.toContain(
      'hosted_linq_line_phone_number_key',
    );
    expect(hostedLinqObservabilityMigrationSql).not.toContain("raw_payload");
    expect(orphanedHostedLinqInviteDeliveryDeletionMigrationSql).toContain(
      'DELETE FROM "hosted_linq_delivery"',
    );
    expect(orphanedHostedLinqInviteDeliveryDeletionMigrationSql).toContain(
      "'invite_signup', 'invite_signup_fallback'",
    );
    expect(orphanedHostedLinqInviteDeliveryDeletionMigrationSql).toContain(
      'split_part("delivery"."source_ref", \':\', 2)',
    );
    expect(orphanedHostedLinqInviteDeliveryDeletionMigrationSql).toContain(
      "NOT EXISTS",
    );
    expect(orphanedHostedLinqInviteDeliveryDeletionMigrationSql).toContain(
      'FROM "hosted_member"',
    );
    expect(orphanedHostedLinqInviteDeliveryContractMigrationSql).toBe(
      orphanedHostedLinqInviteDeliveryDeletionMigrationSql,
    );
    expect(hostedLinqEgressEngagementMigrationSql).toContain('"linq_last_inbound_at" TIMESTAMP(3)');
    expect(hostedLinqEgressEngagementMigrationSql).toContain('"pending_linq_last_inbound_at" TIMESTAMP(3)');
    expect(hostedLinqEgressEngagementMigrationSql).toContain('"last_inbound_at" TIMESTAMP(3)');
    expect(hostedLinqEgressEngagementMigrationSql).not.toContain(
      'SET "linq_last_inbound_at" = CURRENT_TIMESTAMP',
    );
    expect(hostedLinqEgressEngagementMigrationSql).not.toContain(
      'SET "pending_linq_last_inbound_at" = CURRENT_TIMESTAMP',
    );
    expect(hostedLinqEgressEngagementMigrationSql).not.toContain(
      'SET "last_inbound_at" = CURRENT_TIMESTAMP',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP INDEX IF EXISTS "hosted_member_routing_linq_last_inbound_at_idx"',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP INDEX IF EXISTS "hosted_member_routing_pending_linq_last_inbound_at_idx"',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP INDEX IF EXISTS "hosted_thread_route_channel_last_inbound_at_idx"',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP COLUMN IF EXISTS "linq_last_inbound_at"',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP COLUMN IF EXISTS "pending_linq_last_inbound_at"',
    );
    expect(staleLinqRecencyDropMigrationSql).toContain(
      'DROP COLUMN IF EXISTS "last_inbound_at"',
    );
    expect(hostedLinqDeliveryRetryAfterMigrationSql).toContain(
      'ADD COLUMN "retry_after_at" TIMESTAMP(3)',
    );
    expect(hostedMemberAssistantModelPreferenceMigrationSql).toContain(
      'ALTER TABLE "hosted_member"',
    );
    expect(hostedMemberAssistantModelPreferenceMigrationSql).toContain(
      'ADD COLUMN "assistant_model_preference" TEXT',
    );
    expect(hostedMemberAssistantModelPreferenceMigrationSql).not.toContain(
      "NOT NULL",
    );
    expect(hostedMemberAssistantModelPreferenceMigrationSql).not.toContain(
      "DEFAULT",
    );
    expect(hostedMemberAssistantProviderPreferenceMigrationSql).toContain(
      'ALTER TABLE "hosted_member"',
    );
    expect(hostedMemberAssistantProviderPreferenceMigrationSql).toContain(
      'ADD COLUMN "assistant_provider_preference" TEXT',
    );
    expect(hostedMemberAssistantProviderPreferenceMigrationSql).not.toContain(
      "NOT NULL",
    );
    expect(hostedMemberAssistantProviderPreferenceMigrationSql).not.toContain(
      "DEFAULT",
    );
    expect(hostedLinqObservabilityMigrationSql).toContain('"skipped_at" TIMESTAMP(3)');
    expect(hostedLinqObservabilityMigrationSql).toContain('"skip_reason" TEXT');
    expect(hostedLinqEgressEngagementMigrationSql).not.toContain("raw_payload");
    expect(actionApprovalConsumedAtMigrationSql).toContain(
      'ADD COLUMN "consumed_at" TIMESTAMP(3)',
    );
    expect(actionApprovalConsumedAtMigrationSql).toContain(
      '"approval_status" = \'approved\'',
    );
    expect(computerHandoffReturnContactKindMigrationSql).toContain(
      'ADD COLUMN "return_contact_kind" TEXT',
    );
    expect(computerHandoffReturnContactKindMigrationSql).toContain(
      'ADD CONSTRAINT "hosted_computer_handoff_return_contact_kind_check"',
    );
    expect(computerHandoffViewportSessionHintMigrationSql).toContain(
      'ADD COLUMN "computer_handoff_viewport_width" INTEGER',
    );
    expect(computerHandoffViewportSessionHintMigrationSql).toContain(
      'ADD COLUMN "computer_handoff_viewport_height" INTEGER',
    );
    expect(linqFirstContactAdmissionDecisionMigrationSql).toContain(
      'CREATE TABLE "hosted_linq_first_contact_admission_decision"',
    );
    expect(linqFirstContactAdmissionDecisionMigrationSql).toContain(
      'PRIMARY KEY ("event_id")',
    );
    expect(linqFirstContactAdmissionDecisionMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactAdmissionDecisionMigrationSql).not.toContain(
      "response",
    );
    expect(linqFirstContactAdmissionDecisionMigrationSql).not.toContain(
      "rejected_message_text",
    );
    expect(schema).not.toContain("rejectedMessageText");
    expect(schema).not.toContain("rejected_message_text");
    expect(linqFirstContactAdmissionBudgetMigrationSql).toContain(
      'CREATE TABLE "hosted_linq_first_contact_admission_budget"',
    );
    expect(linqFirstContactAdmissionBudgetMigrationSql).toContain(
      'PRIMARY KEY ("participant_contact_lookup_key", "event_id")',
    );
    expect(linqFirstContactAdmissionBudgetMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactAdmissionBudgetMigrationSql).not.toContain(
      "response",
    );
    expect(linqFirstContactAdmissionBudgetMigrationSql).not.toContain(
      "phone_number",
    );
    expect(linqFirstContactAdmissionBudgetMigrationSql).not.toContain(
      '"text"',
    );
    expect(linqFirstContactAdmissionDropCategoryMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_linq_first_contact_admission_decision_category_check"',
    );
    expect(linqFirstContactAdmissionDropCategoryMigrationSql).toContain(
      'ALTER COLUMN "category" DROP NOT NULL',
    );
    expect(linqFirstContactAdmissionDropCategoryMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactAdmissionDropCategoryMigrationSql).not.toContain(
      "response",
    );
    expect(linqFirstContactRejectedMessageMigrationSql).toContain(
      'ADD COLUMN "rejected_message_text" TEXT',
    );
    expect(linqFirstContactRejectedMessageMigrationSql).toContain(
      'char_length("rejected_message_text") <= 2000',
    );
    expect(linqFirstContactRejectedMessageMigrationSql).toContain(
      '"decision" = \'block\'',
    );
    expect(linqFirstContactRejectedMessageMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactRejectedMessageMigrationSql).not.toContain(
      "response",
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).toContain(
      'UPDATE "hosted_linq_first_contact_admission_decision"',
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).toContain(
      'SET "rejected_message_text" = NULL',
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).toContain(
      'WHERE "rejected_message_text" IS NOT NULL',
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).not.toContain(
      "DROP COLUMN",
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactScrubRejectedMessageMigrationSql).not.toContain(
      "response",
    );
    expect(linqFirstContactDropRejectedMessageMigrationSql).toContain(
      'SET "rejected_message_text" = NULL',
    );
    expect(linqFirstContactDropRejectedMessageMigrationSql).toContain(
      'DROP CONSTRAINT IF EXISTS "hosted_linq_first_contact_admission_decision_rejected_message_check"',
    );
    expect(linqFirstContactDropRejectedMessageMigrationSql).toContain(
      'DROP COLUMN IF EXISTS "rejected_message_text"',
    );
    expect(linqFirstContactDropRejectedMessageMigrationSql).not.toContain(
      "prompt",
    );
    expect(linqFirstContactDropRejectedMessageMigrationSql).not.toContain(
      "response",
    );
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
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain(
      'CREATE TABLE "device_sync_companion_capture_receipt"',
    );
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain(
      '"envelope_hash" TEXT NOT NULL',
    );
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain(
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain(
      'CREATE INDEX "device_sync_companion_capture_receipt_user_id_connection_id_created_at_idx"',
    );
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).not.toContain("resource_encrypted");
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain(
      'REFERENCES "device_connection"("id")',
    );
    expect(deviceSyncCompanionCaptureReceiptMigrationSql).toContain("ON DELETE CASCADE");
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
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      'ADD COLUMN "reply_runtime_attempt_id" TEXT',
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      'ADD COLUMN "linq_delivery_id" TEXT',
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      'REFERENCES "hosted_linq_delivery"("id")',
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      'ON "hosted_runtime_log"("attempt_id", "event_code", "at")',
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_runtime_log_attempt_id_event_code_at_idx"',
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).toContain(
      "ON DELETE SET NULL",
    );
    expect(hostedIngressLatencyDeliveryLinkMigrationSql).not.toMatch(
      /(?:raw|body|payload|content|message_text)/iu,
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
    expect(deviceOauthSessionConsumedAtMigrationSql).toContain(
      'ALTER TABLE "device_oauth_session" ADD COLUMN "consumed_at" TIMESTAMP(3);',
    );
    expect(schema).toMatch(
      /model HostedMailboxItem \{[\s\S]*consumedAt\s+DateTime\?\s+@map\("consumed_at"\)/u,
    );
    expect(hostedMailboxItemConsumedAtMigrationSql).toContain(
      'ALTER TABLE "hosted_mailbox_item" ADD COLUMN "consumed_at" TIMESTAMP(3);',
    );
    expect(hostedMailboxItemConsumedAtMigrationSql).not.toContain("CREATE TABLE");
    expect(hostedMailboxItemConsumedAtMigrationSql).not.toContain("CREATE INDEX");
    expect(schema).toMatch(
      /model HostedMailboxItem \{[\s\S]*causalSeq\s+BigInt\?\s+@map\("causal_seq"\)/u,
    );
    expect(hostedMailboxCausalSeqMigrationSql).toContain(
      'ADD COLUMN "causal_seq" BIGINT',
    );
    expect(hostedMailboxCausalSeqMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_causal_seq_key"',
    );
    expect(hostedMailboxCausalSeqMigrationSql).not.toContain(
      'ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"',
    );
    expect(hostedMailboxCausalSeqContractMigrationSql).toContain(
      'ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"',
    );
    expect(hostedMailboxCausalSeqContractMigrationSql).toMatch(
      /"lane_seq" > COALESCE\([\s\S]*"hosted_mailbox_lane_counter"\."consumed_seq",[\s\S]*0[\s\S]*\)/u,
    );
    expect(hostedMailboxCausalSeqContractMigrationSql).toContain("NOT VALID");
    expect(hostedMailboxCausalSeqContractMigrationSql).not.toContain('"consumed_at"');
    expect(assistantPreferenceProjectionWatermarkContractMigrationSql).toContain(
      'FROM "hosted_mailbox_lane_counter" AS causal_counter',
    );
    expect(assistantPreferenceProjectionWatermarkContractMigrationSql).toContain(
      "causal_counter.\"lane\" = 'causal'",
    );
    expect(assistantPreferenceProjectionWatermarkContractMigrationSql).toContain(
      'COALESCE(causal_counter."next_seq" - 1, 0)',
    );
    expect(assistantPreferenceProjectionWatermarkContractMigrationSql).toMatch(
      /WHEN member\."assistant_tone" IS NULL THEN NULL[\s\S]*GREATEST\([\s\S]*member\."assistant_tone_causal_seq"/u,
    );
    expect(assistantPreferenceProjectionWatermarkContractMigrationSql).toMatch(
      /WHEN member\."assistant_voice" IS NULL THEN NULL[\s\S]*GREATEST\([\s\S]*member\."assistant_voice_causal_seq"/u,
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
    expect(hostedVaultShareActiveIndexesMigrationSql).toContain(
      'CREATE INDEX "hosted_vault_share_active_grantor_projection_idx"',
    );
    expect(hostedVaultShareActiveIndexesMigrationSql).toContain(
      'ON "hosted_vault_share"("grantor_member_id", "projection_kind")',
    );
    expect(hostedVaultShareActiveIndexesMigrationSql).toContain(
      'CREATE INDEX "hosted_vault_share_active_destination_projection_idx"',
    );
    expect(hostedVaultShareActiveIndexesMigrationSql).toContain(
      'ON "hosted_vault_share"("destination_member_id", "projection_kind")',
    );
    expect(hostedVaultShareActiveIndexesMigrationSql.match(/WHERE "status" = 'granted'/gu))
      .toHaveLength(2);
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


  it("keeps legacy Linq delivery health blocking until the post-drain lane", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const predeploySql = readFileSync(
      new URL(
        "../prisma/migrations/20260729180000_linq_provider_health_projection/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const postDrainSql = readFileSync(
      new URL(
        "../prisma/contract-migrations/20260729183000_rebuild_linq_delivery_health_after_drain/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(predeploySql).toContain(
      'ADD COLUMN "provider_service_updated_at" TIMESTAMP(3)',
    );
    expect(predeploySql).toContain(
      'ADD COLUMN "provider_reputation_updated_at" TIMESTAMP(3)',
    );
    expect(predeploySql).not.toMatch(
      /UPDATE "hosted_linq_line"\s+SET "health_status"/u,
    );
    expect(postDrainSql).toMatch(
      /UPDATE "hosted_linq_line"\s+SET "health_status" = CASE/u,
    );
    expect(postDrainSql).toContain(
      'WHEN "consecutive_failures" > 0',
    );
    expect(postDrainSql.indexOf(
      '"provider_service_status" = UPPER("provider_status")',
    )).toBeLessThan(postDrainSql.indexOf(
      'SET "health_status" = CASE',
    ));
    expect(postDrainSql.indexOf(
      '"provider_reputation_status" = UPPER("provider_status")',
    )).toBeLessThan(postDrainSql.indexOf(
      'SET "health_status" = CASE',
    ));
    expect(schema).toContain(
      'providerServiceUpdatedAt   DateTime? @map("provider_service_updated_at")',
    );
    expect(schema).toContain(
      'providerReputationUpdatedAt DateTime? @map("provider_reputation_updated_at")',
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

  it("stores multi-part Linq receipt identities under one delivery without raw provider ids", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const migrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260729160000_hosted_linq_delivery_messages/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const messageModel = readPrismaModelBlock(
      schema,
      "HostedLinqDeliveryMessage",
    );

    expect(messageModel).toMatch(
      /messageLookupKey\s+String\s+@unique\s+@map\("message_lookup_key"\)/u,
    );
    expect(messageModel).toMatch(
      /delivery\s+HostedLinqDelivery\s+@relation\(fields: \[deliveryId\], references: \[id\], onDelete: Cascade\)/u,
    );
    expect(messageModel).not.toMatch(/\bmessageId\s+String\b/u);
    expect(migrationSql).toContain(
      'REFERENCES "hosted_linq_delivery"("id")',
    );
    expect(migrationSql).toContain("ON DELETE CASCADE");
    expect(migrationSql).not.toMatch(/"message_id"\s+TEXT/u);
  });

  it("adds only nullable Checkout-attempt columns and their lookup index", () => {
    const migrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260727200000_hosted_member_checkout_attempt/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migrationSql).toContain(
      'ADD COLUMN "checkout_attempt_id" TEXT',
    );
    expect(migrationSql).toContain(
      'ADD COLUMN "checkout_created_at" TIMESTAMP(3)',
    );
    expect(migrationSql).toContain(
      'ADD COLUMN "checkout_intent_hash" TEXT',
    );
    expect(migrationSql).toContain(
      'ADD COLUMN "stripe_checkout_session_id_encrypted" TEXT',
    );
    expect(migrationSql).toContain(
      'ADD COLUMN "stripe_checkout_session_lookup_key" TEXT',
    );
    expect(migrationSql).not.toContain("NOT NULL");
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX\s+"hosted_member_billing_ref_stripe_checkout_session_lookup_key_key"/u,
    );
  });

  it("adds the product-feedback digest read index without blocking writes", () => {
    const migrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260731001500_add_hosted_product_feedback_created_at_index/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY "hosted_product_feedback_created_at_kind_idx"',
    );
    expect(migrationSql).toContain(
      'ON "hosted_product_feedback"("created_at", "kind")',
    );
  });
});

function readHostedMemberModelNames(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(Hosted(?:ConnectedApp\w*|MealPhotoCaptureEnrollment|Member\w*|PendingGroupSetup|SensitiveActionChallenge))\s+\{/gmu)]
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
