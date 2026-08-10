import { type HostedBillingStatus, Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { sanitizeHostedRuntimeErrorCode } from "@murphai/device-syncd/hosted-runtime";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";

import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import {
  createHostedDeviceSyncRegistry,
  createHostedDeviceSyncRegistryWithProviderConfigs,
} from "../device-sync/providers";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
  type ComposioConnectedAccount,
} from "../connected-apps/composio";
import {
  formatHostedConnectedAppToolkitLabel,
  readHostedConnectedAppsConfig,
} from "../connected-apps/config";
import { resolveHostedDeviceSyncBrowserProviderLabel } from "../device-sync/provider-label";
import {
  resolveDeviceProviderApplicationForConnection,
} from "../device-sync/provider-applications";
import { acquireHostedWebhookTraceOwnerLockTx } from "../device-sync/webhook-trace-owner-lock";
import { createHostedPrivyUserLookupKey } from "../hosted-onboarding/contact-privacy";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { readHostedMemberStripeBillingRef } from "../hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
} from "../hosted-onboarding/member-channel-sync";
import {
  reconcileHostedPrivyIdentityOnMemberTx,
} from "../hosted-onboarding/member-identity-service";
import { readHostedAccountGroupStripeBillingRef } from "../hosted-onboarding/family-plan";
import {
  acquireHostedGroupJoinOutreachDrainLockTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  cancelHostedGroupSponsorshipsForPayerAccountDeletionTx,
} from "../hosted-groups/group-sponsorship-authorization";
import {
  hasHostedLinqInviteSignupLiveDeliveryTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  releaseHostedLinqOnboardingLinkNoticeClaim,
} from "../hosted-onboarding/linq-daily-state";
import {
  buildHostedLinqInviteSignupEffectIdMemberPrefix,
  parseHostedLinqInviteSignupEffectId,
} from "../hosted-onboarding/linq-invite-signup-effect-id";
import {
  acquireHostedPrivyPhoneTransferPhoneLocksTx,
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx,
  HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS,
  prepareHostedPrivyPhoneTransferSourceRetirementTx,
  type HostedPrivyPhoneTransferProof,
  type HostedPrivyPhoneTransferSourceRetirementProof,
} from "../hosted-onboarding/privy-phone-transfer-retirement";
import { readHostedPrivyUserById } from "../hosted-onboarding/privy";
import { buildHostedPrivySessionState } from "../hosted-onboarding/privy-user";
import {
  isHostedPulseTrialSubscriptionForKnownPolicy,
  retrieveHostedPulseTrialCleanupTarget,
} from "../hosted-onboarding/pulse-trial-subscription-cleanup";
import {
  hasHostedStripeSubscriptionPaymentMethod,
} from "../hosted-onboarding/stripe-subscription-payment-method";
import {
  getHostedOnboardingStripe,
  requireHostedStripeBillingPlanConfig,
} from "../hosted-onboarding/runtime";
import { logHostedStripeFailure } from "../hosted-onboarding/stripe-error-log";
import { retrieveAndExpireHostedSubscriptionCheckout } from "../hosted-onboarding/subscription-checkout-lifecycle";
import { listHostedMemberSubscriptionCheckoutSessionIds } from "../hosted-onboarding/subscription-checkout-store";
import {
  generateHostedAccountExitReasonId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import type { HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
} from "../hosted-onboarding/usage-credit-purchase-service";
import type { HostedRunnerUserDataDeletionBestEffortResult } from "../hosted-execution/user-data-delete";
import {
  terminateHostedUserRuntimeWorkflowBestEffort,
} from "../hosted-orchestration/workflow-termination";
import {
  assertHostedPhoneCallsReadyForAccountDeletionTx,
  deleteHostedPhoneCallsForAccountDeletion,
} from "../phone-calls/account-deletion";
import {
  HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH,
  type HostedAccountExitReasonCode,
  isHostedAccountExitReasonCode,
} from "./account-data-shared";
import {
  HOSTED_ACCOUNT_DELETION_IMMEDIATE_ATTEMPT_TIMEOUT_MS,
  pendingHostedAccountDeletionCleanupResult,
  persistHostedAccountDeletionCleanupTx,
  prepareHostedAccountDeletionCleanup,
  runHostedAccountDeletionCleanup,
  type HostedAccountDeletionCleanupRunResult,
  type HostedAccountVendorDeletionResult,
  type PreparedHostedAccountDeletionCleanup,
} from "./account-deletion-cleanup";

export type {
  HostedAccountVendorDeletionResult,
  HostedAccountVendorDeletionStatus,
} from "./account-deletion-cleanup";

export type HostedAccountStoreDeletionMode =
  | "live-delete"
  | "best-effort-delete"
  | "local-reference-delete"
  | "documented-retention";

const HOSTED_ACCOUNT_DELETION_SUSPENSION_FENCE_TRANSACTION_OPTIONS = {
  ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  // Group-aware provider fences expire after fifteen seconds. Deletion gets a
  // strictly larger callback budget so an admitted bounded send can commit its
  // correlated consequence before suspension crosses the shared drain.
  timeout: 20_000,
} as const;
const HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_TIMEOUT_MS = 5_000;
const HOSTED_PRIVY_PHONE_TRANSFER_MIN_TRIAL_REMAINING_SECONDS = 10;
const HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_REQUEST_OPTIONS: Stripe.RequestOptions = {
  maxNetworkRetries: 0,
  timeout: HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_TIMEOUT_MS,
};

export interface HostedAccountDataStoreCoverageEntry {
  readonly slug: string;
  readonly label: string;
  readonly deletion: HostedAccountStoreDeletionMode;
  readonly note: string;
}

export const HOSTED_ACCOUNT_DATA_STORE_COVERAGE = [
  {
    slug: "prisma.hosted_member",
    label: "Prisma hosted member record",
    deletion: "live-delete",
    note: "Deletes the member row after child stores are explicitly deleted; Prisma cascade remains a safety net.",
  },
  {
    slug: "prisma.hosted_inference_connection",
    label: "Encrypted custom inference connection",
    deletion: "live-delete",
    note: "Deletes the selected state, encrypted endpoint and credential, model, protocol, capabilities, and verification metadata before the member row. Browser-facing projections expose only sanitized connection metadata and never the credential or ciphertext.",
  },
  {
    slug: "prisma.hosted_web_session",
    label: "Hosted web app sessions",
    deletion: "live-delete",
    note: "Deletes active and revoked claim-bound app-session authenticators. Export reports counts only and omits session authenticators.",
  },
  {
    slug: "prisma.hosted_sensitive_action_challenge",
    label: "Short-lived sensitive-action challenges",
    deletion: "live-delete",
    note: "Deletes hashed sensitive-action challenges and durable Assistant approval decisions stored in the same member-scoped table. User exports omit these rows, token hashes, action hashes, signatures, and wallet authorization material.",
  },
  {
    slug: "prisma.hosted_member_identity",
    label: "Privy identity and encrypted contact hints",
    deletion: "live-delete",
    note: "Confirmed export includes decrypted user-facing phone, Privy, and wallet identity fields while omitting lookup keys and active phone-code attempt IDs.",
  },
  {
    slug: "prisma.hosted_address_book_projection",
    label: "Optional address-book projection state",
    deletion: "live-delete",
    note: "Deletes sharing status, mutation history, revision, and retention timestamps. Export reports status and counts only, never mutation identifiers.",
  },
  {
    slug: "prisma.hosted_address_book_contact",
    label: "Encrypted address-book advisory names and member-scoped phone tokens",
    deletion: "live-delete",
    note: "Deletes every encrypted advisory name and keyed phone token before the projection owner. Export omits names, ciphertext, tokens, and token versions.",
  },
  {
    slug: "prisma.hosted_member_routing",
    label: "Linq, Telegram, reply-alias routing bindings",
    deletion: "live-delete",
    note: "Confirmed export includes decrypted user-facing Linq and Telegram routing IDs and pending Linq participant contacts while omitting lookup keys used for inbound traffic matching.",
  },
  {
    slug: "prisma.hosted_pending_group_setup",
    label: "Encrypted pending next-group setup",
    deletion: "live-delete",
    note: "Deletes the member's short-lived encrypted next-group style and room-context intent before routing and identity rows. Export reports only row counts and never exposes the blinded line key, ciphertext, or decoded setup.",
  },
  {
    slug: "prisma.hosted_member_email_authorization",
    label: "Email authorization state",
    deletion: "live-delete",
    note: "Confirmed export includes verified-email and direct-public-sender addresses when available while omitting address lookup keys.",
  },
  {
    slug: "prisma.hosted_member_billing_ref",
    label: "Local Stripe billing references",
    deletion: "local-reference-delete",
    note: "Confirmed export includes local Stripe customer/subscription references. The Stripe subscription and customer themselves are canceled/deleted by the vendor-account deletion step.",
  },
  {
    slug: "prisma.hosted_member_subscription_checkout",
    label: "Open Stripe subscription Checkout references",
    deletion: "local-reference-delete",
    note: "Keeps every direct subscription Checkout session encrypted until account deletion has made it terminal. Export reports counts only and omits session capabilities.",
  },
  {
    slug: "prisma.hosted_account_group",
    label: "Hosted Family plan group ownership",
    deletion: "live-delete",
    note: "Deletes Family plan groups owned by the member during account deletion. Export reports counts only and never exposes other family members' private account data.",
  },
  {
    slug: "prisma.hosted_account_group_membership",
    label: "Hosted Family plan memberships",
    deletion: "live-delete",
    note: "Deletes the member's Family plan memberships and memberships in groups they own. Export reports counts only so sponsorship does not disclose relatives' health or message data.",
  },
  {
    slug: "prisma.hosted_account_group_invite",
    label: "Hosted Family plan invitations",
    deletion: "live-delete",
    note: "Deletes Family invitations sent, accepted, or owned through the member's Family group. Export reports counts only and omits invite codes and private target contact values.",
  },
  {
    slug: "prisma.hosted_account_group_billing_ref",
    label: "Hosted Family plan Stripe references",
    deletion: "local-reference-delete",
    note: "Deletes local Family Stripe references for groups owned by the member. Family billing cancellation runs before local deletion so sponsored access cannot keep billing after owner deletion.",
  },
  {
    slug: "prisma.hosted_account_group_plan_capacity",
    label: "Hosted Family paid tier capacity",
    deletion: "live-delete",
    note: "Deletes the aggregate per-tier capacity projection for Family groups owned by the member. Export reports counts only and never exposes Stripe item identifiers.",
  },
  {
    slug: "prisma.hosted_group",
    label: "Generic hosted groups",
    deletion: "live-delete",
    note: "Deletes generic hosted groups owned by the member or backed by one of the member's runtimes. Export omits join codes and other members' private data.",
  },
  {
    slug: "prisma.hosted_group_member",
    label: "Generic hosted group memberships",
    deletion: "live-delete",
    note: "Deletes the member's generic group memberships and memberships in groups they own. Export reports role/status metadata only.",
  },
  {
    slug: "prisma.hosted_group_disclosure_permission",
    label: "Hosted group disclosure permissions",
    deletion: "live-delete",
    note: "Deletes exact group-visible permission policies for generic groups owned by the member or backed by one of the member's runtimes. The Settings export remains vault-only; members can inspect the exact policy text through the private list_memberships response.",
  },
  {
    slug: "prisma.hosted_group_disclosure_grant",
    label: "Hosted group disclosure grants",
    deletion: "live-delete",
    note: "Deletes the member's disclosure grants and every grant in generic groups they own or back. The Settings export remains vault-only; the private list_memberships response exposes the exact granted policy text without exposing other members' grants.",
  },
  {
    slug: "prisma.hosted_account_deletion_cleanup",
    label: "Encrypted account-deletion cleanup receipt",
    deletion: "documented-retention",
    note: "Creates a minimal encrypted retry receipt atomically with account deletion and removes it after isolated runtime-log, Cloudflare, Stripe, and Privy cleanup converges.",
  },
  {
    slug: "prisma.hosted_mailbox_item",
    label: "Hosted mailbox envelopes",
    deletion: "live-delete",
    note: "Deletes lane items, inline ciphertext, payload refs, dedupe keys, and sequence counters. Export includes mailbox envelope metadata and omits decoded payload bodies.",
  },
  {
    slug: "prisma.hosted_mailbox_payload",
    label: "Hosted mailbox payload ciphertext",
    deletion: "live-delete",
    note: "Deletes encrypted payload blobs. Export reports payload presence and bytes while omitting ciphertext and decoded arbitrary payload JSON.",
  },
  {
    slug: "prisma.hosted_mailbox_lane_counter",
    label: "Hosted mailbox lane counters",
    deletion: "live-delete",
    note: "Deletes per-lane sequence counters so deleted users cannot resume mailbox lanes.",
  },
  {
    slug: "prisma.hosted_ingress_latency_trace",
    label: "Hosted ingress latency traces",
    deletion: "live-delete",
    note: "Deletes hosted ingress timing rows. Export includes aggregate counts only and omits internal correlation identifiers.",
  },
  {
    slug: "prisma.hosted_workspace",
    label: "Hosted workspace state",
    deletion: "live-delete",
    note: "Deletes hosted workspace checkpoint refs, browser vault replica refs, next-wake state, inbox media-retention wake state, and redacted status.",
  },
  {
    slug: "prisma.hosted_computer_run",
    label: "Hosted computer-use runs",
    deletion: "live-delete",
    note: "Deletes Kernel browser sessions, Managed Auth connections, and profiles before local run rows. Export includes redacted run/checkpoint metadata and omits credentials, auth connection ids, live-view URLs, Kernel session ids, and Kernel profile names.",
  },
  {
    slug: "prisma.hosted_computer_handoff",
    label: "Hosted computer-use handoffs",
    deletion: "live-delete",
    note: "Deletes short-lived handoff rows and token hashes. Export includes handoff status metadata and omits token hashes.",
  },
  {
    slug: "prisma.hosted_phone_call",
    label: "Hosted phone calls",
    deletion: "live-delete",
    note: "Deletes phone-call rows and encrypted private briefs/results explicitly. Export reports counts only and omits private content and ciphertext.",
  },
  {
    slug: "prisma.hosted_physical_note",
    label: "Hosted physical notes",
    deletion: "live-delete",
    note: "Deletes bounded Lob request, status, pricing, and provider-reference rows with the hosted member. Postal addresses and artwork are never stored here; mail already accepted by Lob cannot be recalled from Lob or postal carriers.",
  },
  {
    slug: "postgres.hosted_runtime_log",
    label: "Isolated runtime logs",
    deletion: "best-effort-delete",
    note: "The encrypted account-deletion cleanup receipt retries deleting isolated redacted runtime diagnostics until cleanup converges. Late writers recheck primary member authority after taking the same isolated advisory lock and cannot recreate rows after suspension or deletion.",
  },
  {
    slug: "prisma.hosted_user_crypto_envelope",
    label: "Hosted crypto domain root envelopes",
    deletion: "live-delete",
    note: "Deletes signed per-user domain root envelopes. Export reports counts only and omits signed envelope JSON.",
  },
  {
    slug: "prisma.hosted_user_crypto_audit",
    label: "Hosted crypto audit rows",
    deletion: "live-delete",
    note: "Deletes per-user hosted crypto provisioning audit rows. Export reports counts only and omits recipient and root-key audit payloads.",
  },
  {
    slug: "prisma.hosted_ai_usage",
    label: "AI usage and metering rows",
    deletion: "live-delete",
    note: "Deletes member-scoped usage rows. Already-submitted external billing/metering data may remain under vendor retention.",
  },
  {
    slug: "prisma.hosted_ai_usage_period",
    label: "AI usage allowance period rows",
    deletion: "live-delete",
    note: "Deletes member-scoped included-allowance spend aggregates used by the hosted AI usage gate.",
  },
  {
    slug: "prisma.hosted_growth_aggregate",
    label: "Anonymous hosted growth totals",
    deletion: "documented-retention",
    note: "Retains one unjoinable company-wide tracked fulfilled usage-top-up count with no member, payer, beneficiary, purchase, Stripe, event, or timestamp history. It starts from retained rows at tracker cutover; successful fulfillment then increments it atomically, and account deletion cannot identify a person from it or decrement it.",
  },
  {
    slug: "prisma.hosted_usage_credit_entry",
    label: "Hosted usage-credit ledger entries",
    deletion: "live-delete",
    note: "Deletes member-scoped usage-credit ledger entries before their purchase, referral, and member owners. The deletion result reports row counts; browser-vault export omits semantic source keys and usage-allocation history.",
  },
  {
    slug: "prisma.hosted_usage_credit_grant",
    label: "Hosted usage-credit grant projections",
    deletion: "live-delete",
    note: "Deletes member-scoped mutable remaining-credit projections before their canonical ledger entries.",
  },
  {
    slug: "prisma.hosted_usage_referral",
    label: "Hosted usage referrals",
    deletion: "live-delete",
    note: "Deletes unearned member-scoped referral state. A rewarded grant retained for a surviving group keeps only an anonymized accounting receipt with referrer, introduced-member, target-chat, and observation evidence removed.",
  },
  {
    slug: "prisma.hosted_usage_credit_purchase",
    label: "Hosted usage-credit purchases",
    deletion: "live-delete",
    note: "Deletes local purchase state and encrypted Stripe references after ledger entries. The deletion result reports row counts; browser-vault export omits Checkout URLs, payment identifiers, request fingerprints, and provider metadata while Stripe retains records it is legally required to keep.",
  },
  {
    slug: "prisma.hosted_product_feedback",
    label: "Hosted product feedback rows",
    deletion: "live-delete",
    note: "Deletes and exports explicitly member-linked product feedback rows. De-identified feedback stored without a member relation, including an anonymous support-issue detail, cannot be associated with an account export or deletion request and follows the existing anonymous product-feedback retention policy.",
  },
  {
    slug: "prisma.hosted_group_join_outreach",
    label: "Pre-member group-join outreach intent",
    deletion: "live-delete",
    note: "Deletes outreach rows this account can reach: those matching the member's phone blind index, and those whose canonical offer belongs to a group the account owns or runs. Rows are resolved by phone because the participant may never have become a member. The outreach row covers encrypted participant contact, scheduling, dedupe, and reaction convergence only; selected line, chat, provider lifecycle, and exact reply occurrence live on related delivery rows. Export omits this pre-member operational intent.",
  },
  {
    slug: "prisma.hosted_group_join_outreach_delivery",
    label: "Group-join outreach provider correlation",
    deletion: "live-delete",
    note: "Deletes opener and group-aware signup-link deliveries through their direct outreach relation, so selected-line, chat, provider attempt, receipt, and exact reply-occurrence history does not outlive the account. The canonical offer supplies group ownership; no hashed source-reference reconstruction is required.",
  },
  {
    slug: "prisma.hosted_linq_daily_state",
    label: "Linq daily message counters",
    deletion: "live-delete",
    note: "Deletes member-scoped Linq daily inbound/outbound quota counters.",
  },
  {
    slug: "prisma.hosted_linq_invite_delivery",
    label: "Linq signup-link delivery records",
    deletion: "live-delete",
    note: "Deletes signup-link delivery records whose delivery identity contains the member id. Unrelated operational delivery records remain under their normal retention policy.",
  },
  {
    slug: "prisma.hosted_invite",
    label: "Hosted invite records",
    deletion: "live-delete",
    note: "Deletes invite codes and channel metadata owned by the member.",
  },
  {
    slug: "prisma.hosted_consent_event",
    label: "Hosted consent event records",
    deletion: "live-delete",
    note: "Deletes member-scoped consent audit events before the member row; export includes scope/action/version metadata without secrets.",
  },
  {
    slug: "prisma.hosted_consent_grant",
    label: "Hosted consent grant records",
    deletion: "live-delete",
    note: "Deletes the member's current consent grants before the member row; export includes scope/status/version metadata.",
  },
  {
    slug: "prisma.hosted_vault_share",
    label: "Hosted vault share grants",
    deletion: "live-delete",
    note: "Share rows are deleted in the same transaction by the hosted_member FK cascade when either the grantor or destination member row is removed.",
  },
  {
    slug: "prisma.hosted_thread_container",
    label: "Hosted external-thread container marker",
    deletion: "live-delete",
    note: "Deletes the marker, owner authority, and monthly usage allowance cap that allow an owned hosted runtime to receive explicit external-thread routes.",
  },
  {
    slug: "prisma.hosted_thread_route",
    label: "Hosted external-thread routes",
    deletion: "live-delete",
    note: "Deletes channel/thread blind-index routes for the member and owned thread-container runtimes. Export reports counts and omits raw external thread ids.",
  },
  {
    slug: "prisma.device_connection",
    label: "Device provider connections and tokens",
    deletion: "live-delete",
    note: "Best-effort provider revocation runs first, then connection rows and encrypted tokens are deleted.",
  },
  {
    slug: "prisma.device_provider_application",
    label: "Encrypted member-owned device provider applications",
    deletion: "live-delete",
    note: "Deletes each member-owned OAuth client application and encrypted client credentials after linked device connection rows are removed. Browser-vault export omits the client identity, ciphertext, and credentials.",
  },
  {
    slug: "prisma.device_sync_companion_capture_receipt",
    label: "Companion capture replay receipts",
    deletion: "live-delete",
    note: "Deletes bounded operational replay metadata, including capture-key and envelope hashes, before device connection rows; receipts expire after 30 days and are capped at 1,024 per connection.",
  },
  {
    slug: "prisma.hosted_connected_apps_session",
    label: "Connected-app Tool Router sessions",
    deletion: "live-delete",
    note: "Revokes provider access through Composio before local Tool Router session references are deleted.",
  },
  {
    slug: "prisma.hosted_connected_app_connect_intent",
    label: "Connected-app connection intents",
    deletion: "live-delete",
    note: "Deletes short-lived connected-app connection claims and account ids after provider revocation has been attempted.",
  },
  {
    slug: "prisma.clinical_record_connect_intent",
    label: "Clinical Records connection intents",
    deletion: "live-delete",
    note: "Deletes short-lived hash-only Clinical Records connection claims.",
  },
  {
    slug: "prisma.clinical_record_oauth_session",
    label: "Clinical Records OAuth sessions",
    deletion: "live-delete",
    note: "Deletes pending SMART state, encrypted PKCE verifiers, and pinned authorization metadata.",
  },
  {
    slug: "prisma.clinical_record_connection",
    label: "Clinical Records provider connections",
    deletion: "live-delete",
    note: "Deletes member-scoped provider metadata, encrypted SMART tokens, and encrypted patient context. Export reports counts only and omits credentials and patient identifiers.",
  },
  {
    slug: "prisma.clinical_record_retrieval_run",
    label: "Clinical Records retrieval runs",
    deletion: "live-delete",
    note: "Deletes bounded retrieval status and aggregate outcome metadata. Raw FHIR records remain vault-owned and are covered by encrypted vault deletion.",
  },
  {
    slug: "prisma.clinical_record_retrieval_request",
    label: "Clinical Records page request guards",
    deletion: "live-delete",
    note: "Deletes hash-only request idempotency and page accounting rows; raw FHIR pages are never stored in these rows.",
  },
  {
    slug: "prisma.device_sync_dirty_connection",
    label: "Device sync dirty state",
    deletion: "live-delete",
    note: "Deletes pending per-connection dirty sync metadata before device connection rows so deletion does not rely on cascades.",
  },
  {
    slug: "prisma.device_sync_dirty_payload",
    label: "Device sync dirty payload rows",
    deletion: "live-delete",
    note: "Deletes pending provider payload jobs before dirty-state and connection rows so raw provider payload retention is bounded.",
  },
  {
    slug: "prisma.device_token_audit",
    label: "Device token audit rows",
    deletion: "live-delete",
    note: "Deletes token audit history by user before device connection rows are removed.",
  },
  {
    slug: "prisma.device_sync_signal",
    label: "Device sync signal rows",
    deletion: "live-delete",
    note: "Deletes pre-existing per-user wake/sync signal history. Deletion-time provider revocation does not enqueue new disconnect or wake work.",
  },
  {
    slug: "prisma.device_oauth_session",
    label: "Device OAuth sessions",
    deletion: "live-delete",
    note: "Deletes pending provider OAuth state rows for the member.",
  },
  {
    slug: "prisma.device_connect_intent",
    label: "Hosted device connect intents",
    deletion: "live-delete",
    note: "Deletes short-lived hosted wearable connection claims for the member.",
  },
  {
    slug: "prisma.device_agent_session",
    label: "Scoped device and companion sessions",
    deletion: "live-delete",
    note: "Deletes bearer-token hashes and session metadata for local device sync agents and short-lived companion extension credentials.",
  },
  {
    slug: "prisma.device_browser_assertion_nonce",
    label: "Device browser assertion nonces",
    deletion: "live-delete",
    note: "Deletes outstanding browser assertion nonces for the member.",
  },
  {
    slug: "prisma.hosted_web_internal_request_nonce",
    label: "Hosted web internal request nonces",
    deletion: "live-delete",
    note: "Deletes per-user internal anti-replay nonces.",
  },
  {
    slug: "prisma.device_webhook_trace",
    label: "Provider webhook trace rows",
    deletion: "live-delete",
    note: "Deletes webhook trace rows for provider accounts linked to the member's device connections when linkage is available. User export omits trace rows and trace counts until the minimized webhook trace model has a safe user linkage.",
  },
  {
    slug: "cloudflare.runner_durable_object",
    label: "Cloudflare runner Durable Object state",
    deletion: "best-effort-delete",
    note: "Best-effort call to hosted execution control clears user runner SQL state and alarms when Cloudflare control is configured.",
  },
  {
    slug: "cloudflare.r2_user_artifacts",
    label: "Cloudflare R2 user bundles, vault replicas, artifacts, runner secrets, and raw email",
    deletion: "best-effort-delete",
    note: "Best-effort hosted execution control deletes opaque per-user runtime and ingress R2 objects when web-hosted domain root context is available. Root envelopes are canonical in web Postgres.",
  },
  {
    slug: "temporal.per_user_runtime_workflow",
    label: "Hosted per-user Temporal runtime workflow",
    deletion: "best-effort-delete",
    note: "Best-effort Temporal termination neutralizes sleeping per-user workflow flags and runtime-result wake state after account deletion commits.",
  },
  {
    slug: "providers.oura_whoop_strava",
    label: "Oura, WHOOP, and Strava provider revocation",
    deletion: "best-effort-delete",
    note: "Uses the existing provider revokeAccess hook where configured before deleting local tokens. Wearable sources without a provider-side revocation hook are deleted locally unless source-side revocation is implemented.",
  },
  {
    slug: "providers.composio_connected_apps",
    label: "Composio connected-app provider revocation",
    deletion: "best-effort-delete",
    note: "Lists connected accounts owned by the hosted member and calls Composio provider revocation before local ownership state is deleted.",
  },
  {
    slug: "providers.linq_telegram_email_messages",
    label: "Linq, Telegram, and email message data",
    deletion: "local-reference-delete",
    note: "Deletes Murph-hosted mailbox/routing records. It does not delete copies already stored in external carrier, Telegram, Linq, or email provider systems.",
  },
  {
    slug: "providers.stripe_privy",
    label: "Stripe and Privy vendor accounts",
    deletion: "best-effort-delete",
    note: "Cancels the Stripe subscription before local deletion (fail-closed), then deletes the Stripe customer and Privy user after local rows are removed; results are reported in the deletion result.",
  },
  {
    slug: "backups",
    label: "Backups and restore media",
    deletion: "documented-retention",
    note: "Live data is deleted immediately. Backup copies age out under infrastructure retention and must not be restored except under documented recovery controls.",
  },
] as const satisfies readonly HostedAccountDataStoreCoverageEntry[];

export type HostedAccountDataStoreSlug = typeof HOSTED_ACCOUNT_DATA_STORE_COVERAGE[number]["slug"];

export interface HostedAccountDeletionRequest {
  confirmationPhrase: typeof HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
  exitFeedback: HostedAccountExitFeedback | null;
}

export interface HostedAccountExitFeedback {
  note: string | null;
  reason: HostedAccountExitReasonCode;
}

export interface HostedAccountDataCounts {
  [key: string]: number;
}

export type HostedAccountProviderRevocationStatus =
  | "not_needed"
  | "revoked"
  | "warning"
  | "failed"
  | "skipped_not_configured";

export interface HostedAccountProviderRevocationResult {
  connectionId: string;
  errorCode: string | null;
  providerLabel: string;
  status: HostedAccountProviderRevocationStatus;
  warningCode: string | null;
}

export interface HostedAccountVendorAccountDeletions {
  privyUser: HostedAccountVendorDeletionResult;
  stripeCustomer: HostedAccountVendorDeletionResult;
  stripeSubscription: HostedAccountVendorDeletionResult;
}

export interface HostedAccountDeletionResult {
  cleanupPending: boolean;
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  deletedAt: string;
  deletedCounts: HostedAccountDataCounts;
  memberId: string;
  providerRevocations: HostedAccountProviderRevocationResult[];
  retentionNotes: readonly string[];
  schema: typeof HOSTED_ACCOUNT_DATA_DELETION_SCHEMA;
  vendorAccounts: HostedAccountVendorAccountDeletions;
}

type HostedAccountDataPrisma = PrismaClient | Prisma.TransactionClient;

type DeviceConnectionIdentity = {
  id: string;
  provider: string;
  providerAccountBlindIndex: string;
  sources: readonly {
    sourceProviderSlug: string;
    status: string;
  }[];
};

type HostedAccountDeletionDatabaseResult = {
  channelSyncDispatch: Awaited<
    ReturnType<typeof enqueueHostedMemberChannelsUpdatedForActiveMemberTx>
  >;
  deletedCounts: HostedAccountDataCounts;
  deletedRuntimeMemberIds: readonly string[];
};

interface HostedPrivyPhoneTransferAccountDeletionCompletion {
  retirement: HostedPrivyPhoneTransferSourceRetirementProof;
  targetMember: HostedMemberCoreState;
  targetPhoneNumberBeforeTransfer: string | null;
  targetPrivyUserId: string;
  transfer: HostedPrivyPhoneTransferProof;
}

export interface HostedPrivyPhoneTransferAccountDeletionResult {
  channelSyncDispatch: Awaited<
    ReturnType<typeof enqueueHostedMemberChannelsUpdatedForActiveMemberTx>
  >;
  deletion: HostedAccountDeletionResult;
}

const HOSTED_ACCOUNT_RETENTION_NOTES = [
  "Messages already delivered to external carrier, Telegram, email, or Linq systems are not recalled from those services.",
  "Stripe retains records it is legally required to keep, such as invoices, under its documented processes.",
  "Infrastructure backups age out automatically under documented retention and are never restored into live systems.",
] as const;

export function parseHostedAccountDeletionRequest(
  body: Record<string, unknown>,
): HostedAccountDeletionRequest {
  if (body.confirmationPhrase !== HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED",
      httpStatus: 400,
      message: `Type ${HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} exactly to delete your account.`,
    });
  }

  return {
    confirmationPhrase: HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
    exitFeedback: parseHostedAccountExitFeedback(body),
  };
}

/**
 * Reads the optional "why are you leaving" answer. Deliberately lenient: an
 * absent, unknown, or malformed answer resolves to null instead of throwing,
 * because nothing about this optional survey may block someone from deleting
 * their own account. Nothing is authorized off these values.
 */
export function parseHostedAccountExitFeedback(
  body: Record<string, unknown>,
): HostedAccountExitFeedback | null {
  if (!isHostedAccountExitReasonCode(body.exitReason)) {
    return null;
  }

  const rawNote = typeof body.exitNote === "string" ? body.exitNote.trim() : "";
  const note = rawNote.slice(0, HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH);

  return {
    note: note.length > 0 ? note : null,
    reason: body.exitReason,
  };
}

export async function deleteHostedAccountData(input: {
  exitFeedback?: HostedAccountExitFeedback | null;
  memberId: string;
  prisma: PrismaClient;
  request: Request;
}): Promise<HostedAccountDeletionResult> {
  const result = await deleteHostedAccountDataInternal({
    ...input,
    phoneTransfer: null,
  });
  return result.deletion;
}

export async function deleteHostedPrivyPhoneTransferSourceAccountData(input: {
  prisma: PrismaClient;
  request: Request;
  retirement: HostedPrivyPhoneTransferSourceRetirementProof;
  targetMember: HostedMemberCoreState;
  targetPhoneNumberBeforeTransfer: string | null;
  targetPrivyUserId: string;
  transfer: HostedPrivyPhoneTransferProof;
}): Promise<HostedPrivyPhoneTransferAccountDeletionResult> {
  if (
    input.retirement.sourceMemberId !== input.transfer.sourceMemberId
    || input.targetMember.id === input.transfer.sourceMemberId
    || input.targetPrivyUserId === input.transfer.sourcePrivyUserId
  ) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
  return deleteHostedAccountDataInternal({
    exitFeedback: null,
    memberId: input.transfer.sourceMemberId,
    phoneTransfer: {
      retirement: input.retirement,
      targetMember: input.targetMember,
      targetPhoneNumberBeforeTransfer: input.targetPhoneNumberBeforeTransfer,
      targetPrivyUserId: input.targetPrivyUserId,
      transfer: input.transfer,
    },
    prisma: input.prisma,
    request: input.request,
  });
}

async function deleteHostedAccountDataInternal(input: {
  exitFeedback?: HostedAccountExitFeedback | null;
  memberId: string;
  phoneTransfer: HostedPrivyPhoneTransferAccountDeletionCompletion | null;
  prisma: PrismaClient;
  request: Request;
}): Promise<HostedPrivyPhoneTransferAccountDeletionResult> {
  const member = await input.prisma.hostedMember.findUnique({
    select: { billingStatus: true, createdAt: true, id: true },
    where: { id: input.memberId },
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }

  const deletionStartedAt = new Date();
  const deletionMemberIds = await markHostedMembersSuspendedForAccountDeletion({
    now: deletionStartedAt,
    ownerMemberId: input.memberId,
    prisma: input.prisma,
  });
  // The suspension fence is committed before provider identifiers are
  // decrypted so relationship writers cannot add ownership outside this
  // durable cleanup snapshot.
  const deletionTargets = await readHostedAccountDeletionExternalTargets({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const terminalCheckoutTargets = await closeHostedSubscriptionCheckoutsForAccountDeletion({
    memberId: input.memberId,
    sessionIds: deletionTargets.stripeCheckoutSessionIds,
  });
  const stripeCustomerIds = dedupeNullableStrings([
    ...deletionTargets.stripeCustomerIds,
    ...terminalCheckoutTargets.stripeCustomerIds,
  ]);
  const stripeSubscriptionIds = dedupeNullableStrings([
    ...deletionTargets.stripeSubscriptionIds,
    ...terminalCheckoutTargets.stripeSubscriptionIds,
  ]);

  let preparedCleanup: PreparedHostedAccountDeletionCleanup;
  try {
    preparedCleanup = await prepareHostedAccountDeletionCleanup({
      now: deletionStartedAt,
      privyUserId: deletionTargets.privyUserId,
      runtimeMemberIds: deletionMemberIds,
      stripeCustomerIds,
      stripeSubscriptionIds,
    });
  } catch (error) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CLEANUP_OWNER_CREATE_FAILED",
      details: { cause: safeErrorCode(error) },
      httpStatus: 503,
      message: "We could not safely schedule complete account cleanup. Retry account deletion.",
      retryable: true,
    });
  }
  await deleteHostedPhoneCallsForAccountDeletion({
    memberIds: deletionMemberIds,
    prisma: input.prisma,
    signal: input.request.signal,
  });
  await Promise.all(deletionMemberIds.map((memberId) =>
    terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: memberId,
    }),
  ));
  const providerRevocationConnectionIdentities = await listDeviceConnectionIdentities({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const deviceProviderRevocations = await revokeDeviceProvidersBestEffort({
    connections: providerRevocationConnectionIdentities,
    memberId: input.memberId,
    request: input.request,
  });
  const connectedAppProviderCleanupStartedAt = new Date();
  const connectedAppRevocations = await revokeConnectedAppsBestEffort({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const providerRevocations = [
    ...deviceProviderRevocations,
    ...connectedAppRevocations,
  ];
  assertProviderRevocationsAllowDeletion(providerRevocations);
  const phoneTransfer = input.phoneTransfer;
  const phoneTransferSessionBeforeBillingCleanup = phoneTransfer
    ? await readHostedPrivyPhoneTransferTargetSession(phoneTransfer)
    : null;
  if (phoneTransfer && phoneTransferSessionBeforeBillingCleanup) {
    // Reclassify immediately before billing cleanup. Stripe can promptly write
    // the cancellation webhook back to this already-fenced source, so the
    // final deletion transaction verifies only the immutable transfer fence.
    const retirementBeforeBillingCleanup = await input.prisma.$transaction(
      (tx) =>
        prepareHostedPrivyPhoneTransferSourceRetirementTx({
          identity: phoneTransferSessionBeforeBillingCleanup.identity,
          member: phoneTransfer.targetMember,
          now: deletionStartedAt,
          prisma: tx,
          targetPhoneNumberBeforeTransfer:
            phoneTransfer.targetPhoneNumberBeforeTransfer,
          transfer: phoneTransfer.transfer,
        }),
      HOSTED_PRIVY_PHONE_TRANSFER_RETIREMENT_TRANSACTION_OPTIONS,
    );
    if (
      !isSameHostedPrivyPhoneTransferRetirement(
        retirementBeforeBillingCleanup,
        phoneTransfer.retirement,
      )
    ) {
      throwHostedPrivyPhoneTransferTargetNotReady();
    }
  }
  // Cancel the subscription before local rows are deleted and fail closed:
  // a deleted account must never keep an active Stripe subscription billing it.
  const stripeSubscription = await cancelHostedStripeSubscriptionsForAccountDeletion({
    memberId: input.memberId,
    ...(phoneTransfer
      ? {
          phoneTransferRetirement: phoneTransfer.retirement,
        }
      : {}),
    stripeSubscriptionIds,
  });
  await closeHostedUsageCreditPurchasesForAccountDeletion({
    memberIds: deletionMemberIds,
    now: deletionStartedAt,
    prisma: input.prisma,
  });
  for (const memberId of deletionMemberIds) {
    await deleteHostedComputerUseExternalStateForAccountDeletion({
      memberId,
      prisma: input.prisma,
    });
  }
  const phoneTransferSession = input.phoneTransfer
    ? await readHostedPrivyPhoneTransferTargetSession(input.phoneTransfer)
    : null;
  const databaseDeletion: HostedAccountDeletionDatabaseResult = await input.prisma.$transaction(async (tx) => {
    if (input.phoneTransfer && phoneTransferSession) {
      await acquireHostedPrivyPhoneTransferPhoneLocksTx({
        prisma: tx,
        targetPhoneNumberBeforeTransfer:
          input.phoneTransfer.targetPhoneNumberBeforeTransfer,
        transferPhoneNumber: input.phoneTransfer.transfer.phoneNumber,
      });
      for (const memberId of [
        input.phoneTransfer.targetMember.id,
        input.phoneTransfer.transfer.sourceMemberId,
      ].sort()) {
        await lockHostedMemberRow(tx, memberId);
      }
      await assertHostedPrivyPhoneTransferSourceRetirementFenceTx({
        identity: phoneTransferSession.identity,
        member: input.phoneTransfer.targetMember,
        prisma: tx,
        targetPhoneNumberBeforeTransfer:
          input.phoneTransfer.targetPhoneNumberBeforeTransfer,
        transfer: input.phoneTransfer.transfer,
      });
    }
    await cancelHostedGroupSponsorshipsForPayerAccountDeletionTx({
      now: deletionStartedAt,
      payerMemberIds: deletionMemberIds,
      tx,
    });
    await lockHostedMemberForAccountDeletionTx({
      memberId: input.memberId,
      prisma: tx,
    });
    const transactionDeletionMemberIds = uniqueStrings([
      input.memberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.memberId,
        prisma: tx,
      }),
    ]);
    const transactionDeletionMemberIdFilter = buildStringInFilter(
      transactionDeletionMemberIds,
    );
    const projectionSnapshot =
      await readHostedGroupJoinOutreachDeletionSnapshot({
        memberIdFilter: transactionDeletionMemberIdFilter,
        prisma: tx,
      });
    const projectionMemberIds = uniqueStrings(
      readHostedLinqSignupProjectionIdentities(
        projectionSnapshot.deliveries,
      ).map((identity) => identity.memberId),
    );
    const deletionMemberIdSet = new Set(transactionDeletionMemberIds);
    const lockedProjectionMemberIds = new Set(
      [...transactionDeletionMemberIds, ...projectionMemberIds].sort(),
    );

    for (const memberId of lockedProjectionMemberIds) {
      if (memberId === input.memberId) {
        continue;
      }
      if (deletionMemberIdSet.has(memberId)) {
        await lockHostedMemberForAccountDeletionTx({
          memberId,
          prisma: tx,
        });
      } else {
        await lockHostedMemberRow(tx, memberId);
      }
    }
    await refreshHostedMembersAccountDeletionFenceTx({
      memberIds: transactionDeletionMemberIds,
      now: deletionStartedAt,
      prisma: tx,
    });
    const transactionDeletionTargets = await readHostedAccountDeletionExternalTargets({
      memberId: input.memberId,
      prisma: tx,
    });
    await assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: transactionDeletionMemberIds,
      now: deletionStartedAt,
      prisma: tx,
    });
    await assertHostedPhoneCallsReadyForAccountDeletionTx({
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });
    await assertNoConnectedAppWritesAfterProviderCleanupTx({
      memberId: input.memberId,
      providerCleanupStartedAt: connectedAppProviderCleanupStartedAt,
      prisma: tx,
    });
    for (const memberId of transactionDeletionMemberIds) {
      await lockHostedComputerUseRowsForAccountDeletionTx({
        memberId,
        prisma: tx,
      });
    }
    const deviceConnectionIdentities = await listDeviceConnectionIdentities({
      memberId: input.memberId,
      prisma: tx,
    });
    await lockDeviceWebhookTraceOwnersForAccountDeletionTx({
      connectionIdentities: deviceConnectionIdentities,
      prisma: tx,
    });
    assertHostedAccountDeletionTargetsUnchanged({
      current: {
        ...transactionDeletionTargets,
        runtimeMemberIds: transactionDeletionMemberIds,
      },
      expected: deletionTargets,
      prepared: preparedCleanup,
    });
    await persistHostedAccountDeletionCleanupTx({
      cleanup: preparedCleanup,
      prisma: tx,
    });
    const deletedCounts = await deleteHostedAccountPrismaRows({
      connectionIdentities: deviceConnectionIdentities,
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });
    let channelSyncDispatch: HostedAccountDeletionDatabaseResult["channelSyncDispatch"] =
      null;
    if (input.phoneTransfer && phoneTransferSession) {
      await reconcileHostedPrivyIdentityOnMemberTx({
        identity: phoneTransferSession.identity,
        member: input.phoneTransfer.targetMember,
        now: deletionStartedAt,
        prisma: tx,
      });
      channelSyncDispatch =
        await enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
          linkedAccounts: phoneTransferSession.linkedAccounts,
          memberId: input.phoneTransfer.targetMember.id,
          occurredAt: deletionStartedAt.toISOString(),
          prisma: tx,
          sourceType: "settings.phone.sync",
        });
    }

    return {
      channelSyncDispatch,
      deletedCounts,
      deletedRuntimeMemberIds: transactionDeletionMemberIds,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const deletedCounts = databaseDeletion.deletedCounts;
  const deletedRuntimeMemberIds = databaseDeletion.deletedRuntimeMemberIds.length > 0
    ? databaseDeletion.deletedRuntimeMemberIds
    : deletionMemberIds;
  // Recorded only once the member's rows are actually gone, so a deletion that
  // failed part way through never leaves a phantom exit in the churn record.
  await recordHostedAccountExitReasonBestEffort({
    billingStatus: member.billingStatus,
    feedback: input.exitFeedback ?? null,
    memberCreatedAt: member.createdAt,
    now: deletionStartedAt,
    prisma: input.prisma,
  });
  await Promise.all(deletedRuntimeMemberIds.map((memberId) =>
    terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: memberId,
    }),
  ));
  let cleanup: HostedAccountDeletionCleanupRunResult;
  try {
    cleanup = await runHostedAccountDeletionCleanup({
      attemptTimeoutMs: HOSTED_ACCOUNT_DELETION_IMMEDIATE_ATTEMPT_TIMEOUT_MS,
      cleanupId: preparedCleanup.id,
      prisma: input.prisma,
    });
  } catch (error) {
    console.error("Hosted account deletion committed with cleanup pending.", {
      cleanupIdSuffix: preparedCleanup.id.slice(-8),
      errorCode: safeErrorCode(error),
    });
    cleanup = pendingHostedAccountDeletionCleanupResult(safeErrorCode(error));
  }
  await Promise.all(deletedRuntimeMemberIds.map((memberId) =>
    terminateHostedUserRuntimeWorkflowBestEffort({
      reason: "account-deleted",
      userId: memberId,
    }),
  ));
  return {
    channelSyncDispatch: databaseDeletion.channelSyncDispatch,
    deletion: {
      cleanupPending: cleanup.cleanupPending,
      cloudflare: cleanup.cloudflare,
      deletedAt: new Date().toISOString(),
      deletedCounts,
      memberId: input.memberId,
      providerRevocations,
      retentionNotes: HOSTED_ACCOUNT_RETENTION_NOTES,
      schema: HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
      vendorAccounts: {
        ...cleanup.vendorAccounts,
        stripeSubscription,
      },
    },
  };
}

async function readHostedPrivyPhoneTransferTargetSession(
  input: HostedPrivyPhoneTransferAccountDeletionCompletion,
): Promise<ReturnType<typeof buildHostedPrivySessionState>> {
  const session = buildHostedPrivySessionState(
    await readHostedPrivyUserById(input.targetPrivyUserId),
  );
  if (
    session.identity.userId !== input.targetPrivyUserId
    || session.identity.phone?.number !== input.transfer.phoneNumber
  ) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
  return session;
}

function isSameHostedPrivyPhoneTransferRetirement(
  current: HostedPrivyPhoneTransferSourceRetirementProof,
  expected: HostedPrivyPhoneTransferSourceRetirementProof,
): boolean {
  return current.sourceMemberId === expected.sourceMemberId
    && (
      current.autoTrialBilling === null
        ? expected.autoTrialBilling === null
        : expected.autoTrialBilling !== null
          && current.autoTrialBilling.stripeCustomerId
            === expected.autoTrialBilling.stripeCustomerId
          && current.autoTrialBilling.stripeSubscriptionId
            === expected.autoTrialBilling.stripeSubscriptionId
    );
}

function throwHostedPrivyPhoneTransferTargetNotReady(): never {
  throw hostedOnboardingError({
    code: "PRIVY_PHONE_NOT_READY",
    httpStatus: 409,
    message:
      "The phone transfer changed while Murph was reconciling it. Try again.",
    retryable: true,
  });
}

/**
 * Persists the optional exit answer. Best effort on purpose: the account is
 * already deleted by this point, and losing one survey row is strictly better
 * than failing a completed deletion. The free-text note is never logged, since
 * it is whatever the departing member chose to type.
 */
async function recordHostedAccountExitReasonBestEffort(input: {
  billingStatus: HostedBillingStatus;
  feedback: HostedAccountExitFeedback | null;
  memberCreatedAt: Date;
  now: Date;
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.feedback) {
    return;
  }

  try {
    await input.prisma.hostedAccountExitReason.create({
      data: {
        billingStatus: input.billingStatus,
        id: generateHostedAccountExitReasonId(),
        note: input.feedback.note,
        reason: input.feedback.reason,
        tenureDays: countWholeDaysBetween(input.memberCreatedAt, input.now),
      },
    });
  } catch (error) {
    console.error(
      `[hosted-privacy] Exit reason capture failed after account deletion (errorCode=${safeErrorCode(error)}).`,
    );
  }
}

function countWholeDaysBetween(startedAt: Date, endedAt: Date): number {
  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }

  return Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
}

async function deleteHostedComputerUseExternalStateForAccountDeletion(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  try {
    await new ComputerUseService({
      store: new PrismaComputerUseStore(input.prisma),
    }).deleteMemberExternalStateForAccountDeletion({
      memberId: input.memberId,
    });
  } catch (error) {
    const cleanupErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Computer-use cleanup failed during account deletion (memberId=${memberId}, errorCode=${cleanupErrorCode}).`,
    );
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_COMPUTER_USE_CLEANUP_FAILED",
      httpStatus: 502,
      message: "We could not delete your active browser automation sessions. Retry account deletion, or contact support if it keeps failing.",
      retryable: true,
    });
  }
}

async function listOwnedHostedThreadContainerMemberIds(input: {
  ownerMemberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<string[]> {
  const rows = await input.prisma.hostedThreadContainer.findMany({
    orderBy: { memberId: "asc" },
    select: { memberId: true },
    where: { ownerMemberId: input.ownerMemberId },
  });

  return rows.map((row) => row.memberId);
}

interface HostedAccountDeletionExternalTargets {
  directStripeSubscriptionId: string | null;
  familyStripeSubscriptionIds: string[];
  privyUserId: string | null;
  stripeCheckoutSessionIds: string[];
  stripeCustomerIds: string[];
  stripeSubscriptionIds: string[];
}

async function readHostedAccountDeletionExternalTargets(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountDeletionExternalTargets> {
  const [billingRef, directCheckoutSessionIds, identity, familyBillingRefs] = await Promise.all([
    readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    listHostedMemberSubscriptionCheckoutSessionIds({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
    listHostedFamilyBillingRefsOwnedByMember({
      memberId: input.memberId,
      prisma: input.prisma,
    }),
  ]);
  const directStripeSubscriptionId = billingRef?.stripeSubscriptionId ?? null;
  const familyStripeSubscriptionIds = dedupeNullableStrings(
    familyBillingRefs.map((billing) => billing.stripeSubscriptionId),
  );

  return {
    directStripeSubscriptionId,
    familyStripeSubscriptionIds,
    privyUserId: identity?.privyUserId ?? null,
    stripeCheckoutSessionIds: dedupeNullableStrings([
      ...directCheckoutSessionIds,
      ...familyBillingRefs.map((billing) => billing.stripeCheckoutSessionId),
    ]),
    stripeCustomerIds: dedupeNullableStrings([
      billingRef?.stripeCustomerId ?? null,
      ...familyBillingRefs.map((billing) => billing.stripeCustomerId),
    ]),
    stripeSubscriptionIds: dedupeNullableStrings([
      directStripeSubscriptionId,
      ...familyStripeSubscriptionIds,
    ]),
  };
}

async function markHostedMembersSuspendedForAccountDeletion(input: {
  now: Date;
  ownerMemberId: string;
  prisma: PrismaClient;
}): Promise<string[]> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberForAccountDeletionTx({
      memberId: input.ownerMemberId,
      prisma: tx,
    });
    const memberIds = uniqueStrings([
      input.ownerMemberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.ownerMemberId,
        prisma: tx,
      }),
    ]);
    for (const memberId of memberIds.slice(1)) {
      await lockHostedMemberForAccountDeletionTx({
        memberId,
        prisma: tx,
      });
    }
    await tx.hostedMember.updateMany({
      data: {
        suspendedAt: input.now,
      },
      where: {
        id: buildStringInFilter(memberIds),
      },
    });
    // Suspension is the account-deletion authority fence for group replies.
    // A group-aware provider effect that already owns the drain finishes before
    // this commits. Every later preparation acquires it after commit and rejects
    // the suspended group runtime.
    await acquireHostedGroupJoinOutreachDrainLockTx(tx);
    return memberIds;
  }, HOSTED_ACCOUNT_DELETION_SUSPENSION_FENCE_TRANSACTION_OPTIONS);
}

async function refreshHostedMembersAccountDeletionFenceTx(input: {
  memberIds: readonly string[];
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.hostedMember.updateMany({
    data: {
      suspendedAt: input.now,
    },
    where: {
      id: buildStringInFilter(input.memberIds),
    },
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function haveSameStrings(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.length === rightSet.size && left.every((value) => rightSet.has(value));
}

function assertHostedAccountDeletionTargetsUnchanged(input: {
  current: HostedAccountDeletionExternalTargets & {
    runtimeMemberIds: readonly string[];
  };
  expected: HostedAccountDeletionExternalTargets;
  prepared: PreparedHostedAccountDeletionCleanup;
}): void {
  if (!haveSameStrings(input.current.runtimeMemberIds, input.prepared.runtimeMemberIds)) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_RUNTIME_SET_CHANGED",
      httpStatus: 503,
      message: "Your account changed during deletion. Retry so every hosted runtime is included.",
      retryable: true,
    });
  }
  const currentPrivyUserLookupKey = createHostedPrivyUserLookupKey(
    input.current.privyUserId,
  );
  if (
    currentPrivyUserLookupKey !== input.prepared.privyUserLookupKey
    || !haveSameStrings(input.current.stripeCheckoutSessionIds, input.expected.stripeCheckoutSessionIds)
    || !haveSameStrings(input.current.stripeCustomerIds, input.expected.stripeCustomerIds)
    || !haveSameStrings(
      input.current.stripeSubscriptionIds,
      input.expected.stripeSubscriptionIds,
    )
  ) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_EXTERNAL_TARGET_SET_CHANGED",
      httpStatus: 503,
      message: "Your account changed during deletion. Retry so every provider record is included.",
      retryable: true,
    });
  }
}

function buildStringInFilter(values: readonly string[]): string | { in: string[] } {
  const uniqueValues = uniqueStrings(values);
  if (uniqueValues.length === 1) {
    return uniqueValues[0]!;
  }
  return { in: uniqueValues };
}

function buildHostedUsageCreditEntryDeletionWhere(
  memberIdFilter: string | { in: string[] },
): Prisma.HostedUsageCreditEntryWhereInput {
  return {
    OR: [
      { beneficiaryMemberId: memberIdFilter },
      { purchase: { beneficiaryMemberId: memberIdFilter } },
    ],
  };
}

function buildHostedUsageCreditPurchaseDeletionWhere(
  memberIdFilter: string | { in: string[] },
): Prisma.HostedUsageCreditPurchaseWhereInput {
  return { beneficiaryMemberId: memberIdFilter };
}

function buildHostedUsageReferralInvolvementWhere(
  memberIdFilter: string | { in: string[] },
): Prisma.HostedUsageReferralWhereInput {
  return {
    OR: [
      { beneficiaryMemberId: memberIdFilter },
      { introducedMemberId: memberIdFilter },
      { referrerMemberId: memberIdFilter },
      { targetContainerMemberId: memberIdFilter },
    ],
  };
}

function buildHostedLinqInviteSignupDeliveryWhere(
  memberIds: readonly string[],
): Prisma.HostedLinqDeliveryWhereInput {
  return {
    groupJoinOutreachId: null,
    OR: uniqueStrings(memberIds).map((memberId) => ({
      sourceRef: {
        startsWith: buildHostedLinqInviteSignupEffectIdMemberPrefix(memberId),
      },
    })),
    template: {
      in: ["invite_signup", "invite_signup_fallback"],
    },
  };
}

type HostedGroupJoinOutreachDeletionSnapshot = {
  deliveries: Array<{ sourceRef: string | null }>;
  deliveryWhere: Prisma.HostedLinqDeliveryWhereInput | null;
  outreachIds: string[];
};

type HostedLinqSignupProjectionIdentity = {
  dayUtc: string;
  memberId: string;
};

async function readHostedGroupJoinOutreachDeletionSnapshot(input: {
  memberIdFilter: string | { in: string[] };
  prisma: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachDeletionSnapshot> {
  const identities = await input.prisma.hostedMemberIdentity.findMany({
    where: { memberId: input.memberIdFilter },
    select: { phoneLookupKey: true },
  });
  const phoneLookupKeys = uniqueStrings(
    identities
      .map((identity) => identity.phoneLookupKey)
      .filter((lookupKey): lookupKey is string => Boolean(lookupKey)),
  );
  const ownedGroups = await input.prisma.hostedGroup.findMany({
    where: {
      OR: [
        { ownerMemberId: input.memberIdFilter },
        { runtimeMemberId: input.memberIdFilter },
      ],
    },
    select: { id: true },
  });
  const ownedGroupIds = ownedGroups.map((group) => group.id);
  if (phoneLookupKeys.length === 0 && ownedGroupIds.length === 0) {
    return { deliveries: [], deliveryWhere: null, outreachIds: [] };
  }

  const outreaches = await input.prisma.hostedGroupJoinOutreach.findMany({
    where: {
      OR: [
        ...(phoneLookupKeys.length > 0
          ? [{ participantPhoneLookupKey: { in: phoneLookupKeys } }]
          : []),
        ...(ownedGroupIds.length > 0
          ? [{
              offer: {
                groupId: { in: ownedGroupIds },
              },
            }]
          : []),
      ],
    },
    select: { id: true },
  });
  const outreachIds = outreaches.map((outreach) => outreach.id);
  if (outreachIds.length === 0) {
    return { deliveries: [], deliveryWhere: null, outreachIds: [] };
  }

  const deliveryWhere: Prisma.HostedLinqDeliveryWhereInput = {
    groupJoinOutreachId: { in: outreachIds },
  };
  const deliveries = await input.prisma.hostedLinqDelivery.findMany({
    select: { sourceRef: true },
    where: deliveryWhere,
  });

  return { deliveries, deliveryWhere, outreachIds };
}

function readHostedLinqSignupProjectionIdentities(
  deliveries: readonly { sourceRef: string | null }[],
): HostedLinqSignupProjectionIdentity[] {
  const identities = new Map<string, HostedLinqSignupProjectionIdentity>();
  for (const delivery of deliveries) {
    const attempt = parseHostedLinqInviteSignupEffectId(delivery.sourceRef);
    if (!attempt) {
      continue;
    }
    const identity = {
      dayUtc: attempt.dayUtc,
      memberId: attempt.memberId,
    };
    identities.set(`${identity.memberId}\0${identity.dayUtc}`, identity);
  }
  return [...identities.values()];
}

async function deleteHostedGroupJoinOutreachRowsForMembers(
  prisma: Prisma.TransactionClient,
  memberIdFilter: string | { in: string[] },
): Promise<{ deliveryCount: number; outreachCount: number }> {
  // The outreach row and its delivery rows are one privacy record. Both the
  // minute drain and group-reply delivery preparation cross this same drain, so
  // no related delivery can appear after the delete and before the outreach row
  // is gone.
  await acquireHostedGroupJoinOutreachDrainLockTx(prisma);

  const snapshot = await readHostedGroupJoinOutreachDeletionSnapshot({
    memberIdFilter,
    prisma,
  });
  if (!snapshot.deliveryWhere) {
    return { deliveryCount: 0, outreachCount: 0 };
  }
  const projectionIdentities = readHostedLinqSignupProjectionIdentities(
    snapshot.deliveries,
  );

  // The earlier suspension transaction crossed this same drain before commit.
  // A provider effect admitted first therefore committed its correlation and
  // projection before suspension, while every later preparation observes the
  // suspended group runtime and stops before provider dispatch. No group-aware
  // provider effect can still be in flight when these rows are removed.
  const deliveries = await prisma.hostedLinqDelivery.deleteMany({
    where: snapshot.deliveryWhere,
  });
  for (const identity of projectionIdentities) {
    const hasLiveDelivery = await hasHostedLinqInviteSignupLiveDeliveryTx({
      dayUtc: identity.dayUtc,
      memberId: identity.memberId,
      prisma,
    });
    if (!hasLiveDelivery) {
      await releaseHostedLinqOnboardingLinkNoticeClaim({
        memberId: identity.memberId,
        occurredAt: identity.dayUtc,
        prisma,
      });
    }
  }
  const removed = await prisma.hostedGroupJoinOutreach.deleteMany({
    where: { id: { in: snapshot.outreachIds } },
  });

  return { deliveryCount: deliveries.count, outreachCount: removed.count };
}

async function assertNoConnectedAppWritesAfterProviderCleanupTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  providerCleanupStartedAt: Date;
}): Promise<void> {
  const writes = await input.prisma.hostedConnectedAppConnectIntent.findMany({
    select: { claimHash: true },
    take: 1,
    where: {
      expiresAt: { gt: new Date() },
      memberId: input.memberId,
      startedAt: { gte: input.providerCleanupStartedAt },
    },
  });
  if (writes.length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_CONNECTED_APP_WRITE_IN_PROGRESS",
    httpStatus: 503,
    message: "A connected-app connection changed during account deletion. Retry account deletion before local account records are removed.",
    retryable: true,
  });
}

async function closeHostedSubscriptionCheckoutsForAccountDeletion(input: {
  memberId: string;
  sessionIds: readonly string[];
}): Promise<{
  stripeCustomerIds: string[];
  stripeSubscriptionIds: string[];
}> {
  if (input.sessionIds.length === 0) {
    return {
      stripeCustomerIds: [],
      stripeSubscriptionIds: [],
    };
  }

  const stripe = getHostedOnboardingStripe();
  if (!stripe) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_NOT_CONFIGURED",
      httpStatus: 500,
      message: "Billing is not configured, so your Checkout could not be closed. Contact support to delete your account.",
    });
  }

  const terminalCheckouts: Array<
    Awaited<ReturnType<typeof retrieveAndExpireHostedSubscriptionCheckout>>
  > = [];
  for (const sessionId of input.sessionIds) {
    try {
      const terminal = await retrieveAndExpireHostedSubscriptionCheckout({
        sessionId,
        stripe,
      });
      if (terminal.status === "complete" && !terminal.subscriptionId) {
        throw new TypeError(
          "Completed Stripe subscription Checkout is missing its subscription.",
        );
      }
      terminalCheckouts.push(terminal);
    } catch (error) {
      throw hostedOnboardingError({
        code: "ACCOUNT_DELETION_STRIPE_CHECKOUT_CLOSE_FAILED",
        details: { cause: safeErrorCode(error) },
        httpStatus: 502,
        message: "We could not close your active billing Checkout. Retry account deletion, or contact support if it keeps failing.",
        retryable: true,
      });
    }
  }

  return {
    stripeCustomerIds: dedupeNullableStrings(
      terminalCheckouts.map((checkout) => checkout.customerId),
    ),
    stripeSubscriptionIds: dedupeNullableStrings(
      terminalCheckouts.map((checkout) => checkout.subscriptionId),
    ),
  };
}

async function cancelHostedStripeSubscriptionsForAccountDeletion(input: {
  memberId: string;
  phoneTransferRetirement?: HostedPrivyPhoneTransferSourceRetirementProof;
  stripeSubscriptionIds: readonly string[];
}): Promise<HostedAccountVendorDeletionResult> {
  if (input.phoneTransferRetirement) {
    if (input.phoneTransferRetirement.sourceMemberId !== input.memberId) {
      throwHostedPrivyPhoneTransferBillingAuthorityChanged();
    }
    const autoTrialBilling = input.phoneTransferRetirement.autoTrialBilling;
    if (autoTrialBilling === null) {
      if (input.stripeSubscriptionIds.length > 0) {
        throwHostedPrivyPhoneTransferBillingAuthorityChanged();
      }
      return {
        errorCode: null,
        status: "skipped_no_record",
      };
    }
    if (
      input.stripeSubscriptionIds.length !== 1
      || input.stripeSubscriptionIds[0]
        !== autoTrialBilling.stripeSubscriptionId
    ) {
      throwHostedPrivyPhoneTransferBillingAuthorityChanged();
    }
    return cancelHostedPrivyPhoneTransferAutoTrialForAccountDeletion({
      memberId: input.memberId,
      stripeCustomerId: autoTrialBilling.stripeCustomerId,
      stripeSubscriptionId: autoTrialBilling.stripeSubscriptionId,
    });
  }

  let result: HostedAccountVendorDeletionResult = {
    errorCode: null,
    status: "skipped_no_record",
  };
  for (const stripeSubscriptionId of input.stripeSubscriptionIds) {
    result = await cancelHostedStripeSubscriptionForAccountDeletion({
      memberId: input.memberId,
      stripeSubscriptionId,
    });
  }
  return result;
}

async function cancelHostedPrivyPhoneTransferAutoTrialForAccountDeletion(input: {
  memberId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<HostedAccountVendorDeletionResult> {
  const { priceId, stripe } = requireHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  let subscription: Awaited<
    ReturnType<typeof retrieveHostedPulseTrialCleanupTarget>
  >;
  try {
    subscription = await retrieveHostedPulseTrialCleanupTarget({
      expandCustomer: true,
      expectedCustomerId: input.stripeCustomerId,
      memberId: input.memberId,
      priceId,
      requestOptions:
        HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_REQUEST_OPTIONS,
      stripe,
      subscriptionId: input.stripeSubscriptionId,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_PULSE_TRIAL_CLEANUP_TARGET_CHANGED"
    ) {
      throwHostedPrivyPhoneTransferBillingAuthorityChanged();
    }
    throw error;
  }
  if (!subscription) {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }
  assertHostedPrivyPhoneTransferUnusedStripeSurface({
    memberId: input.memberId,
    priceId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription,
  });
  if (subscription.status === "canceled") {
    assertHostedPrivyPhoneTransferCanceledDuringTrial(subscription);
    return {
      errorCode: null,
      status: "completed",
    };
  }
  if (subscription.status === "incomplete_expired") {
    return {
      errorCode: null,
      status: "completed",
    };
  }
  if (subscription.status !== "trialing") {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }
  const trialEnd = subscription.trial_end;
  if (
    typeof trialEnd !== "number"
    || !Number.isInteger(trialEnd)
    || trialEnd <= (
      Math.floor(Date.now() / 1_000)
      + HOSTED_PRIVY_PHONE_TRANSFER_MIN_TRIAL_REMAINING_SECONDS
    )
  ) {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }

  let canceledSubscription: Awaited<
    ReturnType<typeof stripe.subscriptions.cancel>
  >;
  try {
    canceledSubscription = await stripe.subscriptions.cancel(
      input.stripeSubscriptionId,
      { expand: ["customer"] },
      HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_REQUEST_OPTIONS,
    );
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: "subscription.cancel.phone-transfer",
    });
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_SUBSCRIPTION_CANCEL_FAILED",
      httpStatus: 502,
      message:
        "We could not cancel the unused trial while linking your phone. Try again, or contact support if it keeps failing.",
      retryable: true,
    });
  }
  if (
    canceledSubscription.status !== "canceled"
  ) {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }
  assertHostedPrivyPhoneTransferUnusedStripeSurface({
    memberId: input.memberId,
    priceId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscription: canceledSubscription,
  });
  assertHostedPrivyPhoneTransferCanceledDuringTrial(canceledSubscription);
  return {
    errorCode: null,
    status: "completed",
  };
}

function assertHostedPrivyPhoneTransferUnusedStripeSurface(input: {
  memberId: string;
  priceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): void {
  const customer = input.subscription.customer;
  if (
    input.subscription.id !== input.stripeSubscriptionId
    || !customer
    || typeof customer !== "object"
    || customer.object !== "customer"
    || customer.deleted
    || customer.id !== input.stripeCustomerId
    || !isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription: input.subscription,
    })
    || input.subscription.collection_method !== "charge_automatically"
    || hasHostedStripeSubscriptionPaymentMethod(input.subscription)
    || input.subscription.cancel_at !== null
    || input.subscription.cancel_at_period_end !== false
    || input.subscription.pending_invoice_item_interval !== null
    // Stripe itself attaches a pending SetupIntent to every
    // automatic-collection trial without a payment method, so its presence
    // is provider scaffolding. A setup intent that ever succeeded sets the
    // payment method checked above, which stays fail-closed.
    || input.subscription.pending_update !== null
    || input.subscription.pause_collection !== null
    || input.subscription.schedule !== null
    || input.subscription.trial_settings?.end_behavior.missing_payment_method
      !== "pause"
  ) {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }
}

function assertHostedPrivyPhoneTransferCanceledDuringTrial(
  subscription: Stripe.Subscription,
): void {
  const endedAt = subscription.ended_at;
  const trialEnd = subscription.trial_end;
  if (
    typeof endedAt !== "number"
    || !Number.isInteger(endedAt)
    || typeof trialEnd !== "number"
    || !Number.isInteger(trialEnd)
    || endedAt > trialEnd
  ) {
    throwHostedPrivyPhoneTransferBillingAuthorityChanged();
  }
}

function throwHostedPrivyPhoneTransferBillingAuthorityChanged(): never {
  throw hostedOnboardingError({
    code: "PRIVY_PHONE_TRANSFER_REQUIRES_SUPPORT",
    httpStatus: 409,
    message:
      "That phone belongs to another Murph account with saved activity. Contact support to reconcile it safely.",
  });
}

async function listHostedFamilyBillingRefsOwnedByMember(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<Array<{
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}>> {
  const groups = await input.prisma.hostedAccountGroup.findMany({
    select: {
      id: true,
    },
    where: {
      ownerMemberId: input.memberId,
    },
  });

  const billingRefs = await Promise.all(
    groups.map((group) =>
      readHostedAccountGroupStripeBillingRef({
        groupId: group.id,
        prisma: input.prisma,
      })
    ),
  );

  return billingRefs
    .filter((billingRef): billingRef is NonNullable<typeof billingRef> => billingRef !== null)
    .map((billingRef) => ({
      stripeCheckoutSessionId: billingRef.stripeCheckoutSessionId,
      stripeCustomerId: billingRef.stripeCustomerId,
      stripeSubscriptionId: billingRef.stripeSubscriptionId,
    }));
}

async function cancelHostedStripeSubscriptionForAccountDeletion(input: {
  memberId: string;
  stripeSubscriptionId: string | null;
}): Promise<HostedAccountVendorDeletionResult> {
  if (!input.stripeSubscriptionId) {
    return { errorCode: null, status: "skipped_no_record" };
  }

  const stripe = getHostedOnboardingStripe();
  if (!stripe) {
    // Fail closed: a subscription reference exists, so proceeding without a
    // Stripe client could leave a deleted account with an active subscription.
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_NOT_CONFIGURED",
      httpStatus: 500,
      message: "Billing is not configured, so your subscription could not be canceled. Contact support to delete your account.",
    });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
    // canceled and incomplete_expired are terminal states Stripe refuses to cancel again.
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
      await stripe.subscriptions.cancel(input.stripeSubscriptionId);
    }
    return { errorCode: null, status: "completed" };
  } catch (error) {
    if (isStripeResourceMissingError(error)) {
      return { errorCode: null, status: "skipped_no_record" };
    }

    const cancelErrorCode = safeErrorCode(error);
    const memberId = input.memberId;
    console.error(
      `[hosted-privacy] Stripe subscription cancel failed during account deletion (memberId=${memberId}, errorCode=${cancelErrorCode}).`,
    );
    logHostedStripeFailure({
      error,
      operationName: "subscription.cancel.account-deletion",
    });
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_STRIPE_SUBSCRIPTION_CANCEL_FAILED",
      httpStatus: 502,
      message: "We could not cancel your subscription. Retry account deletion, or contact support if it keeps failing.",
      retryable: true,
    });
  }
}

function dedupeNullableStrings(values: readonly (string | null)[]): string[] {
  return uniqueStrings(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ));
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = Reflect.get(error, "type");
  return Reflect.get(error, "code") === "resource_missing"
    && typeof type === "string"
    && type.startsWith("Stripe");
}

async function deleteHostedAccountPrismaRows(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<HostedAccountDataCounts> {
  const memberIdFilter = buildStringInFilter(input.memberIds);
  const counts: HostedAccountDataCounts = {};
  const record = (key: string, result: { count: number }) => {
    counts[key] = result.count;
  };
  const recordCount = (key: string, count: number) => {
    counts[key] = count;
  };
  recordCount("prisma.hosted_vault_share", await input.prisma.hostedVaultShare.count({
    where: {
      OR: [
        { grantorMemberId: memberIdFilter },
        { destinationMemberId: memberIdFilter },
      ],
    },
  }));

  record("prisma.hosted_mailbox_payload", await input.prisma.hostedMailboxPayload.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_ingress_latency_trace", await input.prisma.hostedIngressLatencyTrace.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_mailbox_item", await input.prisma.hostedMailboxItem.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_mailbox_lane_counter", await input.prisma.hostedMailboxLaneCounter.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_user_crypto_audit", await deleteHostedUserCryptoAuditRows(input.prisma, input.memberIds));
  record("prisma.hosted_user_crypto_envelope", await deleteHostedUserCryptoEnvelopeRows(input.prisma, input.memberIds));
  const usageCreditEntryDeletionWhere =
    buildHostedUsageCreditEntryDeletionWhere(memberIdFilter);
  record("prisma.hosted_usage_credit_grant", await input.prisma.hostedUsageCreditGrant.deleteMany({
    where: { entry: usageCreditEntryDeletionWhere },
  }));
  record("prisma.hosted_usage_credit_entry", await input.prisma.hostedUsageCreditEntry.deleteMany({
    where: usageCreditEntryDeletionWhere,
  }));
  const referralInvolvementWhere =
    buildHostedUsageReferralInvolvementWhere(memberIdFilter);
  const anonymizedRewardedReferrals =
    await input.prisma.hostedUsageReferral.updateMany({
      data: {
        firstHumanMessageAt: null,
        humanMessageCount: 0,
        introducedMemberId: null,
        lastHumanMessageAt: null,
        nonReferrerMessageCount: 0,
        observedEventKeysJson: Prisma.DbNull,
        observedSpeakerKeysJson: Prisma.DbNull,
        referrerMemberId: null,
        referrerSubjectKey: null,
        sourceConversationJson: Prisma.DbNull,
        targetContainerMemberId: null,
      },
      where: {
        AND: [
          referralInvolvementWhere,
          { NOT: { beneficiaryMemberId: memberIdFilter } },
        ],
        status: "rewarded",
      },
    });
  const deletedUsageReferrals = await input.prisma.hostedUsageReferral.deleteMany({
    where: {
      OR: [
        { beneficiaryMemberId: memberIdFilter },
        {
          AND: [
            referralInvolvementWhere,
            { status: { not: "rewarded" } },
          ],
        },
      ],
    },
  });
  recordCount(
    "prisma.hosted_usage_referral",
    anonymizedRewardedReferrals.count + deletedUsageReferrals.count,
  );
  record("prisma.hosted_usage_credit_purchase", await input.prisma.hostedUsageCreditPurchase.deleteMany({
    where: buildHostedUsageCreditPurchaseDeletionWhere(memberIdFilter),
  }));
  record(
    "prisma.hosted_group_sponsorship_authorization",
    await input.prisma.hostedGroupSponsorshipAuthorization.deleteMany({
      where: { beneficiaryMemberId: memberIdFilter },
    }),
  );
  record("prisma.hosted_ai_usage", await input.prisma.hostedAiUsage.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_ai_usage_period", await input.prisma.hostedAiUsagePeriod.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_product_feedback", await input.prisma.hostedProductFeedback.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_codex_auth_connection", await input.prisma.hostedCodexAuthConnection.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_inference_connection", await input.prisma.hostedInferenceConnection.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_linq_daily_state", await input.prisma.hostedLinqDailyState.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_linq_invite_delivery", await input.prisma.hostedLinqDelivery.deleteMany({
    where: buildHostedLinqInviteSignupDeliveryWhere(input.memberIds),
  }));
  // Pre-member group-join outreach is keyed by the participant's phone and by
  // the group, not by a member id, so it is resolved before the identity rows
  // and the owned groups are deleted below. Running after either one would strand
  // the encrypted phone, its group association, or the provider correlation that
  // only the outreach id can find.
  const groupJoinOutreachDeletion =
    await deleteHostedGroupJoinOutreachRowsForMembers(
      input.prisma,
      memberIdFilter,
    );
  recordCount(
    "prisma.hosted_group_join_outreach",
    groupJoinOutreachDeletion.outreachCount,
  );
  recordCount(
    "prisma.hosted_group_join_outreach_delivery",
    groupJoinOutreachDeletion.deliveryCount,
  );
  record("prisma.hosted_invite", await input.prisma.hostedInvite.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_consent_event", await input.prisma.hostedConsentEvent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_consent_grant", await input.prisma.hostedConsentGrant.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_address_book_contact", await input.prisma.hostedAddressBookContact.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_address_book_projection", await input.prisma.hostedAddressBookProjection.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_workspace", await input.prisma.hostedWorkspace.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_computer_handoff", await input.prisma.hostedComputerHandoff.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_computer_run", await input.prisma.hostedComputerRun.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_phone_call", await input.prisma.hostedPhoneCall.deleteMany({ where: { memberId: memberIdFilter } }));
  recordCount("prisma.hosted_physical_note", await input.prisma.hostedPhysicalNote.count({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_email_authorization", await input.prisma.hostedMemberEmailAuthorization.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_subscription_checkout", await input.prisma.hostedMemberSubscriptionCheckout.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_billing_ref", await input.prisma.hostedMemberBillingRef.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_account_group_invite", await input.prisma.hostedAccountGroupInvite.deleteMany({
    where: {
      OR: [
        { acceptedByMemberId: memberIdFilter },
        { group: { ownerMemberId: memberIdFilter } },
        { invitedByMemberId: memberIdFilter },
      ],
    },
  }));
  record("prisma.hosted_account_group_membership", await input.prisma.hostedAccountGroupMembership.deleteMany({
    where: {
      OR: [
        { memberId: memberIdFilter },
        { group: { ownerMemberId: memberIdFilter } },
      ],
    },
  }));
  record("prisma.hosted_account_group_billing_ref", await input.prisma.hostedAccountGroupBillingRef.deleteMany({
    where: {
      group: {
        ownerMemberId: memberIdFilter,
      },
    },
  }));
  record("prisma.hosted_account_group_plan_capacity", await input.prisma.hostedAccountGroupPlanCapacity.deleteMany({
    where: { group: { ownerMemberId: memberIdFilter } },
  }));
  record("prisma.hosted_account_group", await input.prisma.hostedAccountGroup.deleteMany({ where: { ownerMemberId: memberIdFilter } }));
  record("prisma.hosted_group_disclosure_grant", await input.prisma.hostedGroupDisclosureGrant.deleteMany({
    where: {
      OR: [
        { membership: { memberId: memberIdFilter } },
        { membership: { group: { ownerMemberId: memberIdFilter } } },
        { membership: { group: { runtimeMemberId: memberIdFilter } } },
      ],
    },
  }));
  record("prisma.hosted_group_disclosure_permission", await input.prisma.hostedGroupDisclosurePermission.deleteMany({
    where: {
      group: {
        OR: [
          { ownerMemberId: memberIdFilter },
          { runtimeMemberId: memberIdFilter },
        ],
      },
    },
  }));
  record("prisma.hosted_group_member", await input.prisma.hostedGroupMember.deleteMany({
    where: {
      OR: [
        { memberId: memberIdFilter },
        { group: { ownerMemberId: memberIdFilter } },
        { group: { runtimeMemberId: memberIdFilter } },
      ],
    },
  }));
  record("prisma.hosted_group", await input.prisma.hostedGroup.deleteMany({
    where: {
      OR: [
        { ownerMemberId: memberIdFilter },
        { runtimeMemberId: memberIdFilter },
      ],
    },
  }));
  record("prisma.hosted_pending_group_setup", await input.prisma.hostedPendingGroupSetup.deleteMany({
    where: { ownerMemberId: memberIdFilter },
  }));
  record("prisma.hosted_member_routing", await input.prisma.hostedMemberRouting.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_sensitive_action_challenge", await input.prisma.hostedSensitiveActionChallenge.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_web_session", await input.prisma.hostedWebSession.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member_identity", await input.prisma.hostedMemberIdentity.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_thread_route", await input.prisma.hostedThreadRoute.deleteMany({
    where: {
      OR: [
        { containerMemberId: memberIdFilter },
        { container: { ownerMemberId: memberIdFilter } },
      ],
    },
  }));
  record("prisma.hosted_thread_container", await input.prisma.hostedThreadContainer.deleteMany({
    where: {
      OR: [
        { memberId: memberIdFilter },
        { ownerMemberId: memberIdFilter },
      ],
    },
  }));
  record("prisma.hosted_connected_app_connect_intent", await input.prisma.hostedConnectedAppConnectIntent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_connected_apps_session", await input.prisma.hostedConnectedAppsSession.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.clinical_record_retrieval_request", await input.prisma.clinicalRecordRetrievalRequest.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.clinical_record_retrieval_run", await input.prisma.clinicalRecordRetrievalRun.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.clinical_record_oauth_session", await input.prisma.clinicalRecordOauthSession.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.clinical_record_connect_intent", await input.prisma.clinicalRecordConnectIntent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.clinical_record_connection", await input.prisma.clinicalRecordConnection.deleteMany({ where: { memberId: memberIdFilter } }));

  const webhookTraceWhere = buildDeviceWebhookTraceWhere(input.connectionIdentities);
  counts["prisma.device_webhook_trace"] = webhookTraceWhere
    ? (await input.prisma.deviceWebhookTrace.deleteMany({ where: webhookTraceWhere })).count
    : 0;
  record("prisma.device_token_audit", await input.prisma.deviceTokenAudit.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_companion_capture_receipt", await input.prisma.deviceSyncCompanionCaptureReceipt.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_dirty_payload", await input.prisma.deviceSyncDirtyPayload.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_dirty_connection", await input.prisma.deviceSyncDirtyConnection.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_sync_signal", await input.prisma.deviceSyncSignal.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_oauth_session", await input.prisma.deviceOauthSession.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_connect_intent", await input.prisma.deviceConnectIntent.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.device_agent_session", await input.prisma.deviceAgentSession.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_browser_assertion_nonce", await input.prisma.deviceBrowserAssertionNonce.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.hosted_web_internal_request_nonce", await input.prisma.hostedWebInternalRequestNonce.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_connection", await input.prisma.deviceConnection.deleteMany({ where: { userId: memberIdFilter } }));
  record("prisma.device_provider_application", await input.prisma.deviceProviderApplication.deleteMany({ where: { memberId: memberIdFilter } }));
  record("prisma.hosted_member", await input.prisma.hostedMember.deleteMany({ where: { id: memberIdFilter } }));

  return counts;
}

async function deleteHostedUserCryptoEnvelopeRows(
  prisma: Prisma.TransactionClient,
  memberIds: readonly string[],
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_envelope
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return { count };
}

async function deleteHostedUserCryptoAuditRows(
  prisma: Prisma.TransactionClient,
  memberIds: readonly string[],
): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    DELETE FROM hosted_user_crypto_audit
    WHERE user_id IN (${Prisma.join(memberIds)})
  `;
  return { count };
}

async function listDeviceConnectionIdentities(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<DeviceConnectionIdentity[]> {
  return input.prisma.deviceConnection.findMany({
    select: {
      id: true,
      provider: true,
      providerAccountBlindIndex: true,
      sources: {
        orderBy: [
          { status: "asc" },
          { sourceProviderSlug: "asc" },
        ],
        select: {
          sourceProviderSlug: true,
          status: true,
        },
      },
    },
    where: { userId: input.memberId },
  });
}

async function lockHostedMemberForAccountDeletionTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const rows = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${input.memberId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
}

async function lockHostedComputerUseRowsForAccountDeletionTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_run
    WHERE member_id = ${input.memberId}
    ORDER BY id ASC
    FOR UPDATE
  `;
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_handoff
    WHERE member_id = ${input.memberId}
    ORDER BY id ASC
    FOR UPDATE
  `;
}

async function lockDeviceWebhookTraceOwnersForAccountDeletionTx(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const seenTraceOwners = new Set<string>();
  const traceOwners = input.connectionIdentities
    .filter((connection) => connection.providerAccountBlindIndex.length > 0)
    .map((connection) => ({
      provider: connection.provider,
      providerAccountBlindIndex: connection.providerAccountBlindIndex,
    }))
    .filter((traceOwner) => {
      const key = `${traceOwner.provider}:${traceOwner.providerAccountBlindIndex}`;
      if (seenTraceOwners.has(key)) {
        return false;
      }
      seenTraceOwners.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.provider}:${left.providerAccountBlindIndex}`
        .localeCompare(`${right.provider}:${right.providerAccountBlindIndex}`)
    );

  for (const traceOwner of traceOwners) {
    await acquireHostedWebhookTraceOwnerLockTx({
      prisma: input.prisma,
      provider: traceOwner.provider,
      providerAccountBlindIndex: traceOwner.providerAccountBlindIndex,
    });
  }
}

function resolveDeviceConnectionProviderLabel(connection: {
  metadataJson?: Prisma.JsonValue | null;
  provider: string;
  sources?: readonly {
    sourceProviderSlug: string;
    status: string;
  }[];
}): string {
  return resolveHostedDeviceSyncBrowserProviderLabel({
    metadata: connection.metadataJson,
    provider: connection.provider,
    upstreamSources: connection.sources ?? [],
  });
}

async function revokeDeviceProvidersBestEffort(input: {
  connections: readonly DeviceConnectionIdentity[];
  memberId: string;
  request: Request;
}): Promise<HostedAccountProviderRevocationResult[]> {
  if (input.connections.length === 0) {
    return [];
  }

  let controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane>;
  try {
    controlPlane = createHostedDeviceSyncControlPlane(input.request);
  } catch (error) {
    return input.connections.map((connection) => ({
      connectionId: connection.id,
      errorCode: safeErrorCode(error),
      providerLabel: resolveDeviceConnectionProviderLabel(connection),
      status: "skipped_not_configured",
      warningCode: null,
    }));
  }

  const results: HostedAccountProviderRevocationResult[] = [];
  let registry: ReturnType<typeof createHostedDeviceSyncRegistry> | null = null;
  for (const connection of input.connections) {
    try {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.memberId,
        connection.id,
      );

      if (!storedAccount) {
        results.push({
          connectionId: connection.id,
          errorCode: null,
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: "warning",
          warningCode: "CONNECTION_SECRET_MISSING",
        });
        continue;
      }

      const providerApplication =
        await resolveDeviceProviderApplicationForConnection({
          connectionId: connection.id,
          memberId: input.memberId,
          prisma: controlPlane.store.prisma,
        });
      const connectionRegistry = providerApplication
        ? createHostedDeviceSyncRegistryWithProviderConfigs({
            providerConfigs: providerApplication.providerConfigs,
          })
        : (registry ??= createHostedDeviceSyncRegistry(process.env));
      const provider = connectionRegistry.get(connection.provider);
      const revokeAccess = provider?.connectionHandler?.revokeAccess;

      if (!revokeAccess) {
        results.push({
          connectionId: connection.id,
          errorCode: storedAccount.credential.kind === "provider_config"
            ? "PROVIDER_REVOKE_NOT_CONFIGURED"
            : null,
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: storedAccount.credential.kind === "provider_config" ? "failed" : "not_needed",
          warningCode: null,
        });
        continue;
      }

      await revokeAccess(storedAccount);
      results.push({
        connectionId: connection.id,
        errorCode: null,
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "revoked",
        warningCode: null,
      });
    } catch (error) {
      results.push({
        connectionId: connection.id,
        errorCode: safeErrorCode(error),
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "failed",
        warningCode: null,
      });
    }
  }

  return results;
}

async function revokeConnectedAppsBestEffort(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountProviderRevocationResult[]> {
  const inFlightIntents = await listInFlightConnectedAppIntentsForDeletion(input);
  if (inFlightIntents.some((intent) => !intent.connectedAccountId)) {
    return [{
      connectionId: "composio_connected_app_connection_in_progress",
      errorCode: "CONNECTED_APP_CONNECTION_IN_PROGRESS",
      providerLabel: "Connected apps",
      status: "failed",
      warningCode: null,
    }];
  }

  const session = await input.prisma.hostedConnectedAppsSession.findUnique({
    select: { memberId: true },
    where: { memberId: input.memberId },
  });
  const inFlightAccountIds = inFlightIntents
    .map((intent) => intent.connectedAccountId)
    .filter((accountId): accountId is string => !!accountId);
  if (!session && inFlightAccountIds.length === 0) {
    return [];
  }

  let accounts: ComposioConnectedAccount[];
  let client: ReturnType<typeof createComposioConnectedAppsClient>;
  try {
    const config = readHostedConnectedAppsConfig();
    client = createComposioConnectedAppsClient({ config });
    accounts = await client.listAccounts({
      statuses: null,
      toolkits: null,
      userId: input.memberId,
    });
  } catch (error) {
    return [{
      connectionId: "composio_connected_apps",
      errorCode: safeErrorCode(error),
      providerLabel: "Connected apps",
      status: "failed",
      warningCode: null,
    }];
  }

  const results: HostedAccountProviderRevocationResult[] = [];
  const listedAccountIds = new Set(accounts.map((account) => account.id));
  for (const account of accounts.filter(isComposioAccountDeletable)) {
    let status: HostedAccountProviderRevocationStatus = "not_needed";
    let warningCode: string | null = null;

    try {
      if (isComposioAccountRevokable(account)) {
        try {
          await client.disconnectAccount(account.id);
          status = "revoked";
        } catch (error) {
          if (!isNonBlockingComposioRevokeError(error)) {
            results.push({
              connectionId: account.id,
              errorCode: safeErrorCode(error),
              providerLabel: formatConnectedAppProviderLabel(account),
              status: "failed",
              warningCode: null,
            });
            continue;
          }
          status = "warning";
          warningCode = safeErrorCode(error);
        }
      }

      await client.deleteAccount(account.id);
      results.push({
        connectionId: account.id,
        errorCode: null,
        providerLabel: formatConnectedAppProviderLabel(account),
        status,
        warningCode,
      });
    } catch (error) {
      results.push({
        connectionId: account.id,
        errorCode: safeErrorCode(error),
        providerLabel: formatConnectedAppProviderLabel(account),
        status: "failed",
        warningCode: null,
      });
    }
  }

  for (const intent of inFlightIntents) {
    if (!intent.connectedAccountId || listedAccountIds.has(intent.connectedAccountId)) {
      continue;
    }
    try {
      await client.deleteAccount(intent.connectedAccountId);
      results.push({
        connectionId: intent.connectedAccountId,
        errorCode: null,
        providerLabel: formatConnectedAppIntentProviderLabel(intent),
        status: "not_needed",
        warningCode: null,
      });
    } catch (error) {
      results.push({
        connectionId: intent.connectedAccountId,
        errorCode: safeErrorCode(error),
        providerLabel: formatConnectedAppIntentProviderLabel(intent),
        status: "failed",
        warningCode: null,
      });
    }
  }

  return results;
}

async function listInFlightConnectedAppIntentsForDeletion(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<Array<{
  alias: string | null;
  connectedAccountId: string | null;
  toolkit: string;
}>> {
  const now = new Date();
  return await input.prisma.hostedConnectedAppConnectIntent.findMany({
    select: {
      alias: true,
      connectedAccountId: true,
      toolkit: true,
    },
    where: {
      completedAt: null,
      expiresAt: { gt: now },
      memberId: input.memberId,
      startedAt: { not: null },
    },
  });
}

function isComposioAccountDeletable(account: ComposioConnectedAccount): boolean {
  return account.status.toUpperCase() !== "DELETED";
}

function isComposioAccountRevokable(account: ComposioConnectedAccount): boolean {
  return account.status.toUpperCase() === "ACTIVE";
}

function isNonBlockingComposioRevokeError(error: unknown): boolean {
  return error instanceof ComposioConnectedAppsRequestError
    && (error.status === 400 || error.status === 409);
}

function formatConnectedAppProviderLabel(account: ComposioConnectedAccount): string {
  const label = account.toolkit.name
    || formatHostedConnectedAppToolkitLabel(account.toolkit.slug);
  const qualifier = account.alias ?? account.wordId;
  return qualifier ? `${label} (${qualifier})` : label;
}

function formatConnectedAppIntentProviderLabel(input: {
  alias: string | null;
  toolkit: string;
}): string {
  const label = formatHostedConnectedAppToolkitLabel(input.toolkit);
  return input.alias ? `${label} (${input.alias})` : label;
}

function assertProviderRevocationsAllowDeletion(
  providerRevocations: readonly HostedAccountProviderRevocationResult[],
): void {
  const failures = providerRevocations.filter((revocation) => revocation.status === "failed");

  if (failures.length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
    httpStatus: 503,
    message: "Provider access could not be revoked. Retry account deletion before local device records are removed.",
    retryable: true,
    details: {
      providerRevocations: failures.map((failure) => ({
        errorCode: failure.errorCode,
        providerLabel: failure.providerLabel,
      })),
    },
  });
}

function buildDeviceWebhookTraceWhere(
  connections: readonly DeviceConnectionIdentity[],
): Prisma.DeviceWebhookTraceWhereInput | null {
  const traceOwners = connections
    .filter((connection) => connection.providerAccountBlindIndex.length > 0)
    .map((connection) => ({
      provider: connection.provider,
      providerAccountBlindIndex: connection.providerAccountBlindIndex,
    }));

  return traceOwners.length > 0 ? { OR: traceOwners } : null;
}

function safeErrorCode(error: unknown): string {
  if (isDeviceSyncError(error)) {
    return sanitizeHostedRuntimeErrorCode(error.code) ?? "DEVICE_SYNC_ERROR";
  }

  if (error instanceof Error) {
    return sanitizeHostedRuntimeErrorCode(error.name) ?? "ERROR";
  }

  return "UNKNOWN_ERROR";
}
