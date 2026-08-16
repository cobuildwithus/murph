import { type HostedBillingStatus, Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { sanitizeHostedRuntimeErrorCode } from "@murphai/device-syncd/hosted-runtime";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import { DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS } from "@murphai/device-syncd/types";

import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import {
  classifyHostedTokenRefreshLease,
  resolveHostedRefreshLeaseBeforeDestructiveAction,
} from "../device-sync/agent-session-token-refresh";
import { createHostedDeviceSyncRegistry } from "../device-sync/providers";
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
import { hostedConnectedAppStartedIntentOwnerCutoff } from "../connected-apps/connect-intent-ownership";
import {
  formatHostedDeviceSyncProviderLabel,
  resolveHostedDeviceSyncBrowserProviderLabel,
} from "../device-sync/provider-label";
import { resolveHostedDeviceSyncConnectionCleanup } from "../device-sync/provider-application-cleanup";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { assertHostedStripeEffectClaimAbsent } from "../hosted-onboarding/hosted-member-billing-store";
import {
  commitPreparedHostedMemberChannelsUpdatedTx,
  prepareHostedMemberChannelsUpdatedForSnapshot,
  resolveHostedMemberEmailLinked,
} from "../hosted-onboarding/member-channel-sync";
import {
  commitPreparedHostedMemberIdentityWriteTx,
  prepareHostedMemberIdentityWrite,
  readHostedMemberIdentity,
  type PreparedHostedMemberIdentityWrite,
} from "../hosted-onboarding/hosted-member-identity-store";
import { buildHostedPersistedPhoneIdentityFields } from "../hosted-onboarding/member-identity-fields";
import {
  HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
  HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
  HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
} from "../hosted-onboarding/family-plan";
import {
  HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
  HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
  HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
} from "../hosted-onboarding/member-private-codecs";
import {
  acquireHostedGroupJoinOutreachDrainLockTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  cancelHostedGroupSponsorshipsForPayerAccountDeletionTx,
} from "../hosted-groups/group-sponsorship-authorization";
import {
  buildHostedLinqInviteSignupEffectId,
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
import {
  HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD,
} from "../hosted-onboarding/subscription-checkout-store";
import {
  generateHostedAccountExitReasonId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  readHostedMemberSnapshot,
  type HostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import type { PreparedHostedMailboxEnvelopeAppend } from "../hosted-mailbox/store";
import {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
} from "../hosted-onboarding/usage-credit-purchase-service";
import type { HostedRunnerUserDataDeletionBestEffortResult } from "../hosted-execution/user-data-delete";
import {
  terminateHostedUserRuntimeWorkflowBestEffort,
} from "../hosted-orchestration/workflow-termination";
import { decryptHostedWebNullableFields } from "../hosted-web/encryption";
import {
  assertHostedPhoneCallsReadyForAccountDeletionTx,
  deleteHostedPhoneCallsForAccountDeletion,
} from "../phone-calls/account-deletion";
import {
  HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE,
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE,
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
import { sha256Hex } from "../primitives";

export type {
  HostedAccountVendorDeletionResult,
  HostedAccountVendorDeletionStatus,
} from "./account-deletion-cleanup";

export type HostedAccountStoreDeletionMode =
  | "live-delete"
  | "best-effort-delete"
  | "local-reference-delete"
  | "documented-retention";

const HOSTED_ACCOUNT_DELETION_CONNECTED_APP_INTENT_LIMIT = 20;
const HOSTED_ACCOUNT_DELETION_SUSPENSION_FENCE_TRANSACTION_OPTIONS = {
  ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  // Group-aware provider fences expire after fifteen seconds. Deletion gets a
  // strictly larger callback budget so an admitted bounded send can commit its
  // correlated consequence before suspension crosses the shared drain.
  timeout: 20_000,
} as const;
const HOSTED_PRIVY_PHONE_TRANSFER_STRIPE_AUTHORITY_TIMEOUT_MS = 5_000;
const HOSTED_PRIVY_PHONE_TRANSFER_MIN_TRIAL_REMAINING_SECONDS = 10;
const HOSTED_ACCOUNT_DELETION_REFRESH_LEASE_RECOVERY_LIMIT = 32;
const HOSTED_ACCOUNT_DELETION_MAX_FAMILY_CLAIM_OWNER_ROWS = 4;
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
    slug: "prisma.hosted_group_current_sender_clarification",
    label: "Pending group answer-audience clarifications",
    deletion: "live-delete",
    note: "Deletes short-lived exact-message pointers used to resume one ambiguous group request. The original question remains in the ordinary mailbox lifecycle and is not copied into this table.",
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
    note: "Requires the provider revokeAccess hook to confirm revocation before deleting a durable cleanup credential. Credential-kind none is the only local proof that no external cleanup remains.",
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
  providerAccessRemovalConfirmationToken: string | null;
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
  | "failed";

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

const hostedAccountDeletionMemberBillingTargetSelect =
  Prisma.validator<Prisma.HostedMemberBillingRefSelect>()({
    memberId: true,
    stripeCustomerIdEncrypted: true,
    stripeCustomerLookupKey: true,
    stripeSubscriptionIdEncrypted: true,
    stripeSubscriptionLookupKey: true,
  });

const hostedAccountDeletionMemberIdentityTargetSelect =
  Prisma.validator<Prisma.HostedMemberIdentitySelect>()({
    memberId: true,
    privyUserIdEncrypted: true,
    privyUserLookupKey: true,
  });

const hostedAccountDeletionCheckoutTargetSelect =
  Prisma.validator<Prisma.HostedMemberSubscriptionCheckoutSelect>()({
    memberId: true,
    stripeCheckoutSessionIdEncrypted: true,
    stripeCheckoutSessionLookupKey: true,
  });

const hostedAccountDeletionFamilyBillingTargetSelect =
  Prisma.validator<Prisma.HostedAccountGroupBillingRefSelect>()({
    group: {
      select: {
        ownerMemberId: true,
      },
    },
    groupId: true,
    stripeCheckoutSessionIdEncrypted: true,
    stripeCheckoutSessionLookupKey: true,
    stripeCustomerIdEncrypted: true,
    stripeCustomerLookupKey: true,
    stripeSubscriptionIdEncrypted: true,
    stripeSubscriptionLookupKey: true,
  });

type HostedAccountDeletionMemberBillingTargetRow =
  Prisma.HostedMemberBillingRefGetPayload<{
    select: typeof hostedAccountDeletionMemberBillingTargetSelect;
  }>;

type HostedAccountDeletionMemberIdentityTargetRow =
  Prisma.HostedMemberIdentityGetPayload<{
    select: typeof hostedAccountDeletionMemberIdentityTargetSelect;
  }>;

type HostedAccountDeletionCheckoutTargetRow =
  Prisma.HostedMemberSubscriptionCheckoutGetPayload<{
    select: typeof hostedAccountDeletionCheckoutTargetSelect;
  }>;

type HostedAccountDeletionFamilyBillingTargetRow =
  Prisma.HostedAccountGroupBillingRefGetPayload<{
    select: typeof hostedAccountDeletionFamilyBillingTargetSelect;
  }>;

interface HostedAccountDeletionTargetRows {
  readonly billingRef: HostedAccountDeletionMemberBillingTargetRow | null;
  readonly checkoutSessions: readonly HostedAccountDeletionCheckoutTargetRow[];
  readonly familyBillingRefs: readonly HostedAccountDeletionFamilyBillingTargetRow[];
  readonly identity: HostedAccountDeletionMemberIdentityTargetRow | null;
}

type DeviceConnectionIdentity = {
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  connectedAt: Date;
  credentialKind: string;
  credentialMetadataJson: Prisma.JsonValue;
  externalAccountIdEncrypted: string | null;
  id: string;
  keyVersion: string | null;
  metadataJson: Prisma.JsonValue;
  provider: string;
  providerApplicationId: string | null;
  providerApplicationRevision: number | null;
  providerAccountBlindIndex: string;
  providerConfigKey: string | null;
  refreshLeaseExpiresAt: Date | null;
  refreshLeaseOwner: string | null;
  refreshLeaseTokenVersion: number | null;
  refreshTokenEncrypted: string | null;
  scopesJson: Prisma.JsonValue;
  sources: readonly {
    id: string;
    sourceInstanceKey: string;
    sourceProviderSlug: string;
    status: string;
  }[];
  status: string;
  tokenVersion: number | null;
};

type HostedAccountDeletionDatabaseResult = {
  channelSyncDispatch: Awaited<
    ReturnType<typeof commitPreparedHostedMemberChannelsUpdatedTx>
  > | null;
  deletedCounts: HostedAccountDataCounts;
  deletedRuntimeMemberIds: readonly string[];
};

type PreparedHostedPrivyPhoneTransferDatabaseCommit = {
  channelAppend: PreparedHostedMailboxEnvelopeAppend;
  identityWrite: PreparedHostedMemberIdentityWrite;
  rawFingerprint: string;
  targetMemberId: string;
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
    ReturnType<typeof commitPreparedHostedMemberChannelsUpdatedTx>
  >;
  deletion: HostedAccountDeletionResult;
}

type HostedAccountDeletionInternalResult = {
  channelSyncDispatch: HostedAccountDeletionDatabaseResult["channelSyncDispatch"];
  deletion: HostedAccountDeletionResult;
};

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
    providerAccessRemovalConfirmationToken:
      typeof body.providerAccessRemovalConfirmationToken === "string"
        ? body.providerAccessRemovalConfirmationToken
        : null,
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
  providerAccessRemovalConfirmationToken?: string | null;
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
  const result = await deleteHostedAccountDataInternal({
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
  if (!result.channelSyncDispatch) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
  return {
    channelSyncDispatch: result.channelSyncDispatch,
    deletion: result.deletion,
  };
}

async function deleteHostedAccountDataInternal(input: {
  exitFeedback?: HostedAccountExitFeedback | null;
  memberId: string;
  phoneTransfer: HostedPrivyPhoneTransferAccountDeletionCompletion | null;
  prisma: PrismaClient;
  providerAccessRemovalConfirmationToken?: string | null;
  request: Request;
}): Promise<HostedAccountDeletionInternalResult> {
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
  await resolveHostedAccountDeletionRefreshLeases({
    memberId: input.memberId,
    now: deletionStartedAt,
    prisma: input.prisma,
    request: input.request,
  });
  const deletionMemberIds = await markHostedMembersSuspendedForAccountDeletion({
    now: deletionStartedAt,
    ownerMemberId: input.memberId,
    prisma: input.prisma,
    providerAccessRemovalConfirmationToken:
      input.providerAccessRemovalConfirmationToken ?? null,
  });
  // Sponsorship owns a beneficiary-first, payer-second lock order. Run that
  // existing owner immediately after the durable suspension fence so no new
  // payer admission can race it and no external deletion work precedes it.
  await input.prisma.$transaction(
    (tx) => cancelHostedGroupSponsorshipsForPayerAccountDeletionTx({
      now: deletionStartedAt,
      payerMemberIds: deletionMemberIds,
      tx,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
  // The suspension fence is committed before provider identifiers are
  // decrypted so relationship writers cannot add ownership outside this
  // durable cleanup snapshot.
  const preparedDeletionTargets =
    await prepareHostedAccountDeletionExternalTargets({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  const deletionTargets = preparedDeletionTargets.targets;
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
  const expectedDeviceAuthorityFingerprint =
    buildDeviceConnectionAuthorityFingerprint(
      providerRevocationConnectionIdentities,
    );
  const deviceProviderRevocations = await revokeDeviceProvidersBestEffort({
    connections: providerRevocationConnectionIdentities,
    memberId: input.memberId,
    request: input.request,
  });
  const connectedAppProviderCleanupStartedAt = new Date();
  const connectedAppRevocations = await revokeConnectedAppsBestEffort({
    memberId: input.memberId,
    now: deletionStartedAt,
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
  const preparedPhoneTransferDatabaseCommit =
    input.phoneTransfer && phoneTransferSession
      ? await prepareHostedPrivyPhoneTransferDatabaseCommit({
          completion: input.phoneTransfer,
          now: deletionStartedAt,
          prisma: input.prisma,
          session: phoneTransferSession,
        })
      : null;
  const databaseDeletion: HostedAccountDeletionDatabaseResult = await input.prisma.$transaction(async (tx) => {
    if (input.phoneTransfer && phoneTransferSession) {
      await acquireHostedPrivyPhoneTransferPhoneLocksTx({
        prisma: tx,
        targetPhoneNumberBeforeTransfer:
          input.phoneTransfer.targetPhoneNumberBeforeTransfer,
        transferPhoneNumber: input.phoneTransfer.transfer.phoneNumber,
      });
    }
    const lockedFamilyClaimOwnerIds =
      await lockHostedFamilyClaimOwnersForAccountDeletionTx({
        memberIds: deletionMemberIds,
        prisma: tx,
      });
    if (input.phoneTransfer && phoneTransferSession) {
      await lockHostedMembersForAccountDeletionTx({
        memberIds: [
          input.phoneTransfer.targetMember.id,
          input.phoneTransfer.transfer.sourceMemberId,
        ],
        prisma: tx,
      });
      if (!preparedPhoneTransferDatabaseCommit) {
        throwHostedPrivyPhoneTransferTargetNotReady();
      }
      await assertHostedPrivyPhoneTransferRawFingerprintUnchangedTx({
        completion: input.phoneTransfer,
        expectedFingerprint: preparedPhoneTransferDatabaseCommit.rawFingerprint,
        prisma: tx,
      });
    }
    await lockHostedMembersForAccountDeletionTx({
      memberIds: deletionMemberIds.filter(
        (memberId) => !lockedFamilyClaimOwnerIds.includes(memberId),
      ),
      prisma: tx,
      requiredMemberIds: deletionMemberIds.filter(
        (memberId) => !lockedFamilyClaimOwnerIds.includes(memberId),
      ),
    });
    const transactionDeletionMemberIds = uniqueStrings([
      input.memberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.memberId,
        prisma: tx,
      }),
    ]);
    if (!haveSameStrings(transactionDeletionMemberIds, deletionMemberIds)) {
      throwHostedAccountDeletionRuntimeSetChanged();
    }
    await assertHostedFamilyClaimOwnersUnchangedForAccountDeletionTx({
      expectedOwnerMemberIds: lockedFamilyClaimOwnerIds,
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });
    const transactionDeletionMemberIdFilter = buildStringInFilter(
      transactionDeletionMemberIds,
    );
    await lockHostedMembersForAccountDeletionTx({
      memberIds: transactionDeletionMemberIds.filter(
        (memberId) => memberId !== input.memberId,
      ),
      prisma: tx,
      requiredMemberIds: transactionDeletionMemberIds.filter(
        (memberId) => memberId !== input.memberId,
      ),
    });
    await refreshHostedMembersAccountDeletionFenceTx({
      memberIds: transactionDeletionMemberIds,
      now: deletionStartedAt,
      prisma: tx,
    });
    await assertNoHostedStripeEffectClaimsForAccountDeletionTx({
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });
    // Every writer for these selected target columns serializes on the
    // owning member row. With the complete deletion member set locked, this
    // is an exact database-only revalidation of the prepared ciphertext and
    // lookup rows.
    const transactionTargetRows =
      await readHostedAccountDeletionTargetRows({
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
    await lockHostedComputerUseRowsForAccountDeletionTx({
      memberIds: transactionDeletionMemberIds,
      prisma: tx,
    });
    await lockDeviceConnectionAuthorityRowsForAccountDeletionTx({
      memberId: input.memberId,
      prisma: tx,
    });
    const deviceConnectionIdentities = await listDeviceConnectionIdentities({
      memberId: input.memberId,
      prisma: tx,
    });
    const inFlightDeviceTokenRefreshCount = deviceConnectionIdentities.filter(
      (connection) =>
        typeof connection.refreshLeaseOwner === "string"
        || connection.refreshLeaseExpiresAt instanceof Date
        || typeof connection.refreshLeaseTokenVersion === "number",
    ).length;
    const inFlightDeviceOauthCallbackCount = await tx.deviceOauthSession.count({
      where: {
        consumedAt: { not: null },
        userId: transactionDeletionMemberIdFilter,
      },
    });
    if (
      inFlightDeviceOauthCallbackCount > 0
      || inFlightDeviceTokenRefreshCount > 0
    ) {
      throw hostedOnboardingError({
        code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
        httpStatus: 503,
        message: "A connected-health authorization or credential refresh is still finishing. Retry account deletion.",
        retryable: true,
      });
    }
    assertHostedAccountDeletionTargetsUnchanged({
      currentDatabaseFingerprint:
        buildHostedAccountDeletionTargetDatabaseFingerprint(
          transactionTargetRows,
        ),
      currentDeviceAuthorityFingerprint:
        buildDeviceConnectionAuthorityFingerprint(deviceConnectionIdentities),
      expectedDatabaseFingerprint:
        preparedDeletionTargets.databaseFingerprint,
      expectedDeviceAuthorityFingerprint,
      runtimeMemberIds: transactionDeletionMemberIds,
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
      if (!preparedPhoneTransferDatabaseCommit) {
        throwHostedPrivyPhoneTransferTargetNotReady();
      }
      await commitPreparedHostedMemberIdentityWriteTx({
        memberId: preparedPhoneTransferDatabaseCommit.targetMemberId,
        prepared: preparedPhoneTransferDatabaseCommit.identityWrite,
        prisma: tx,
      });
      channelSyncDispatch = await commitPreparedHostedMemberChannelsUpdatedTx({
        prepared: preparedPhoneTransferDatabaseCommit.channelAppend,
        prisma: tx,
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

async function prepareHostedPrivyPhoneTransferDatabaseCommit(input: {
  completion: HostedPrivyPhoneTransferAccountDeletionCompletion;
  now: Date;
  prisma: PrismaClient;
  session: Awaited<ReturnType<typeof buildHostedPrivySessionState>>;
}): Promise<PreparedHostedPrivyPhoneTransferDatabaseCommit> {
  // Capture the raw database authority before any decrypted projection or
  // prepared ciphertext is derived. A concurrent writer after this point then
  // makes the locked terminal comparison fail instead of letting an older
  // prepared value overwrite newer target state.
  const rawFingerprint = await readHostedPrivyPhoneTransferRawFingerprint({
    completion: input.completion,
    prisma: input.prisma,
  });
  await assertHostedPrivyPhoneTransferSourceRetirementFenceTx({
    identity: input.session.identity,
    member: input.completion.targetMember,
    prisma: input.prisma,
    targetPhoneNumberBeforeTransfer:
      input.completion.targetPhoneNumberBeforeTransfer,
    transfer: input.completion.transfer,
  });
  const [currentIdentity, currentSnapshot] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.completion.targetMember.id,
      prisma: input.prisma,
    }),
    readHostedMemberSnapshot({
      memberId: input.completion.targetMember.id,
      prisma: input.prisma,
    }),
  ]);
  if (!currentIdentity || !currentSnapshot || !input.session.identity.phone) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
  const nextPhoneIdentity = buildHostedPersistedPhoneIdentityFields({
    currentIdentity,
    now: input.now,
    phone: input.session.identity.phone,
  });
  const identityWrite = await prepareHostedMemberIdentityWrite({
    ...nextPhoneIdentity,
    memberId: input.completion.targetMember.id,
    prisma: input.prisma,
    privyUserId: input.session.identity.userId,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  const desiredSnapshot = {
    ...currentSnapshot,
    identity: {
      ...currentIdentity,
      ...nextPhoneIdentity,
      privyUserId: input.session.identity.userId,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
    },
  };
  const emailLinked = await resolveHostedMemberEmailLinked({
    linkedAccounts: input.session.linkedAccounts,
    memberId: input.completion.targetMember.id,
    prisma: input.prisma,
  });
  const channelAppend = await prepareHostedMemberChannelsUpdatedForSnapshot({
    emailLinked,
    member: desiredSnapshot,
    memberId: input.completion.targetMember.id,
    occurredAt: input.now.toISOString(),
    prisma: input.prisma,
    sourceType: "settings.phone.sync",
  });
  return {
    channelAppend,
    identityWrite,
    rawFingerprint,
    targetMemberId: input.completion.targetMember.id,
  };
}

async function readHostedPrivyPhoneTransferRawFingerprint(input: {
  completion: HostedPrivyPhoneTransferAccountDeletionCompletion;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<string> {
  const [
    sourceIdentity,
    sourceMember,
    targetEmailAuthorization,
    targetIdentity,
    targetMember,
    targetRouting,
  ] =
    await Promise.all([
      input.prisma.hostedMemberIdentity.findUnique({
        where: { memberId: input.completion.transfer.sourceMemberId },
      }),
      input.prisma.hostedMember.findUnique({
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
        where: { id: input.completion.transfer.sourceMemberId },
      }),
      input.prisma.hostedMemberEmailAuthorization.findUnique({
        where: { memberId: input.completion.targetMember.id },
      }),
      input.prisma.hostedMemberIdentity.findUnique({
        where: { memberId: input.completion.targetMember.id },
      }),
      input.prisma.hostedMember.findUnique({
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
        where: { id: input.completion.targetMember.id },
      }),
      input.prisma.hostedMemberRouting.findUnique({
        where: { memberId: input.completion.targetMember.id },
      }),
    ]);
  if (!sourceIdentity || !sourceMember || !targetIdentity || !targetMember) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
  return JSON.stringify([
    sourceMember,
    sourceIdentity,
    targetEmailAuthorization,
    targetMember,
    targetIdentity,
    targetRouting,
  ]);
}

async function assertHostedPrivyPhoneTransferRawFingerprintUnchangedTx(input: {
  completion: HostedPrivyPhoneTransferAccountDeletionCompletion;
  expectedFingerprint: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const currentFingerprint = await readHostedPrivyPhoneTransferRawFingerprint(input);
  if (currentFingerprint !== input.expectedFingerprint) {
    throwHostedPrivyPhoneTransferTargetNotReady();
  }
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
  readonly directStripeSubscriptionId: string | null;
  readonly familyStripeSubscriptionIds: readonly string[];
  readonly privyUserId: string | null;
  readonly stripeCheckoutSessionIds: readonly string[];
  readonly stripeCustomerIds: readonly string[];
  readonly stripeSubscriptionIds: readonly string[];
}

interface PreparedHostedAccountDeletionExternalTargets {
  readonly databaseFingerprint: string;
  readonly targets: HostedAccountDeletionExternalTargets;
}

async function readHostedAccountDeletionTargetRows(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountDeletionTargetRows> {
  const [billingRef, checkoutSessions, familyBillingRefs, identity] =
    await Promise.all([
      input.prisma.hostedMemberBillingRef.findUnique({
        select: hostedAccountDeletionMemberBillingTargetSelect,
        where: { memberId: input.memberId },
      }),
      input.prisma.hostedMemberSubscriptionCheckout.findMany({
        orderBy: [
          { createdAt: "asc" },
          { stripeCheckoutSessionLookupKey: "asc" },
        ],
        select: hostedAccountDeletionCheckoutTargetSelect,
        where: { memberId: input.memberId },
      }),
      input.prisma.hostedAccountGroupBillingRef.findMany({
        orderBy: { groupId: "asc" },
        select: hostedAccountDeletionFamilyBillingTargetSelect,
        where: {
          group: {
            ownerMemberId: input.memberId,
          },
        },
      }),
      input.prisma.hostedMemberIdentity.findUnique({
        select: hostedAccountDeletionMemberIdentityTargetSelect,
        where: { memberId: input.memberId },
      }),
    ]);

  return {
    billingRef,
    checkoutSessions,
    familyBillingRefs,
    identity,
  };
}

function buildHostedAccountDeletionTargetDatabaseFingerprint(
  rows: HostedAccountDeletionTargetRows,
): string {
  const checkoutSessions = [...rows.checkoutSessions]
    .sort((left, right) =>
      left.stripeCheckoutSessionLookupKey.localeCompare(
        right.stripeCheckoutSessionLookupKey,
      )
    )
    .map((row) => [
      row.memberId,
      row.stripeCheckoutSessionLookupKey,
      row.stripeCheckoutSessionIdEncrypted,
    ] as const);
  const familyBillingRefs = [...rows.familyBillingRefs]
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
    .map((row) => [
      row.groupId,
      row.group.ownerMemberId,
      row.stripeCheckoutSessionLookupKey,
      row.stripeCheckoutSessionIdEncrypted,
      row.stripeCustomerLookupKey,
      row.stripeCustomerIdEncrypted,
      row.stripeSubscriptionLookupKey,
      row.stripeSubscriptionIdEncrypted,
    ] as const);

  // This canonical value is carried only in memory and is never persisted or
  // logged. A primitive string cannot be mutated while provider cleanup runs.
  return JSON.stringify([
    rows.billingRef
      ? [
          rows.billingRef.memberId,
          rows.billingRef.stripeCustomerLookupKey,
          rows.billingRef.stripeCustomerIdEncrypted,
          rows.billingRef.stripeSubscriptionLookupKey,
          rows.billingRef.stripeSubscriptionIdEncrypted,
        ]
      : null,
    rows.identity
      ? [
          rows.identity.memberId,
          rows.identity.privyUserLookupKey,
          rows.identity.privyUserIdEncrypted,
        ]
      : null,
    checkoutSessions,
    familyBillingRefs,
  ]);
}

async function prepareHostedAccountDeletionExternalTargets(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<PreparedHostedAccountDeletionExternalTargets> {
  const rows = await readHostedAccountDeletionTargetRows(input);
  const entries: Array<{
    field: string;
    memberId: string;
    value: string | null;
  }> = [];
  const appendEntry = (
    field: string,
    memberId: string,
    value: string | null,
  ): number => {
    entries.push({ field, memberId, value });
    return entries.length - 1;
  };

  const directCustomerIndex = rows.billingRef
    ? appendEntry(
        HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
        rows.billingRef.memberId,
        rows.billingRef.stripeCustomerIdEncrypted,
      )
    : null;
  const directSubscriptionIndex = rows.billingRef
    ? appendEntry(
        HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
        rows.billingRef.memberId,
        rows.billingRef.stripeSubscriptionIdEncrypted,
      )
    : null;
  const privyUserIndex = rows.identity
    ? appendEntry(
        HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
        rows.identity.memberId,
        rows.identity.privyUserIdEncrypted,
      )
    : null;
  const checkoutSessionIndexes = rows.checkoutSessions.map((row) =>
    appendEntry(
      HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD,
      row.memberId,
      row.stripeCheckoutSessionIdEncrypted,
    )
  );
  const familyBillingIndexes = rows.familyBillingRefs.map((row) => ({
    checkoutSession: appendEntry(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
      row.group.ownerMemberId,
      row.stripeCheckoutSessionIdEncrypted,
    ),
    customer: appendEntry(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      row.group.ownerMemberId,
      row.stripeCustomerIdEncrypted,
    ),
    subscription: appendEntry(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      row.group.ownerMemberId,
      row.stripeSubscriptionIdEncrypted,
    ),
  }));
  const decrypted = entries.length > 0
    ? await decryptHostedWebNullableFields({
        entries,
        prisma: input.prisma,
      })
    : [];
  const readDecrypted = (index: number | null): string | null =>
    index === null ? null : decrypted[index] ?? null;
  const directStripeSubscriptionId = readDecrypted(directSubscriptionIndex);
  const familyStripeSubscriptionIds = dedupeNullableStrings(
    familyBillingIndexes.map((indexes) => readDecrypted(indexes.subscription)),
  );
  const stripeCheckoutSessionIds = checkoutSessionIndexes.map((index) => {
    const sessionId = readDecrypted(index);
    if (!sessionId) {
      throw new TypeError("Stored Stripe Checkout session id is unavailable.");
    }
    return sessionId;
  });

  return {
    databaseFingerprint:
      buildHostedAccountDeletionTargetDatabaseFingerprint(rows),
    targets: {
      directStripeSubscriptionId,
      familyStripeSubscriptionIds,
      privyUserId: readDecrypted(privyUserIndex),
      stripeCheckoutSessionIds: dedupeNullableStrings([
        ...stripeCheckoutSessionIds,
        ...familyBillingIndexes.map((indexes) =>
          readDecrypted(indexes.checkoutSession)
        ),
      ]),
      stripeCustomerIds: dedupeNullableStrings([
        readDecrypted(directCustomerIndex),
        ...familyBillingIndexes.map((indexes) =>
          readDecrypted(indexes.customer)
        ),
      ]),
      stripeSubscriptionIds: dedupeNullableStrings([
        directStripeSubscriptionId,
        ...familyStripeSubscriptionIds,
      ]),
    },
  };
}

async function markHostedMembersSuspendedForAccountDeletion(input: {
  now: Date;
  ownerMemberId: string;
  prisma: PrismaClient;
  providerAccessRemovalConfirmationToken: string | null;
}): Promise<string[]> {
  return input.prisma.$transaction(async (tx) => {
    const preparedMemberIds = uniqueStrings([
      input.ownerMemberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.ownerMemberId,
        prisma: tx,
      }),
    ]);
    const lockedFamilyClaimOwnerIds =
      await lockHostedFamilyClaimOwnersForAccountDeletionTx({
        memberIds: preparedMemberIds,
        prisma: tx,
      });
    await lockHostedMembersForAccountDeletionTx({
      memberIds: preparedMemberIds.filter(
        (memberId) => !lockedFamilyClaimOwnerIds.includes(memberId),
      ),
      prisma: tx,
      requiredMemberIds: preparedMemberIds.filter(
        (memberId) => !lockedFamilyClaimOwnerIds.includes(memberId),
      ),
    });
    const memberIds = uniqueStrings([
      input.ownerMemberId,
      ...await listOwnedHostedThreadContainerMemberIds({
        ownerMemberId: input.ownerMemberId,
        prisma: tx,
      }),
    ]);
    if (!haveSameStrings(memberIds, preparedMemberIds)) {
      throwHostedAccountDeletionRuntimeSetChanged();
    }
    await assertHostedFamilyClaimOwnersUnchangedForAccountDeletionTx({
      expectedOwnerMemberIds: lockedFamilyClaimOwnerIds,
      memberIds,
      prisma: tx,
    });
    await assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx({
      memberIds,
      prisma: tx,
    });
    const consumedOauthSessions = await tx.deviceOauthSession.findMany({
      select: {
        consumedAt: true,
        expiresAt: true,
        provider: true,
        state: true,
      },
      where: {
        consumedAt: { not: null },
        userId: buildStringInFilter(memberIds),
      },
    });
    const liveOauthCallbackCount = consumedOauthSessions.filter(
      (session) => input.now.getTime() < Math.max(
        session.expiresAt.getTime(),
        session.consumedAt!.getTime()
          + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
      ),
    ).length;
    if (liveOauthCallbackCount > 0) {
      throw hostedOnboardingError({
        code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
        httpStatus: 503,
        message: "A connected-health authorization is still finishing. Retry account deletion.",
        retryable: true,
      });
    }
    if (consumedOauthSessions.length > 0) {
      const providerLabels = Array.from(new Set(
        consumedOauthSessions.map((session) =>
          formatHostedDeviceSyncProviderLabel(session.provider)
        ),
      )).sort();
      const providerAccessRemovalConfirmationToken =
        buildProviderAccessRemovalConfirmationToken({
          ownerMemberId: input.ownerMemberId,
          sessions: consumedOauthSessions,
        });
      if (
        input.providerAccessRemovalConfirmationToken
        !== providerAccessRemovalConfirmationToken
      ) {
        throw hostedOnboardingError({
          code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_RECOVERY_REQUIRED",
          details: {
            providerAccessRemovalConfirmationToken,
            providerLabels,
          },
          httpStatus: 409,
          message: `Remove Murph access from ${providerLabels.join(" and ")}, then confirm below.`,
          retryable: false,
        });
      }
      const deletedOauthSessions = await tx.deviceOauthSession.deleteMany({
        where: {
          consumedAt: { not: null },
          state: buildStringInFilter(
            consumedOauthSessions.map((session) => session.state),
          ),
          userId: buildStringInFilter(memberIds),
        },
      });
      if (deletedOauthSessions.count !== consumedOauthSessions.length) {
        throw hostedOnboardingError({
          code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
          httpStatus: 503,
          message: "A connected-health authorization changed while account deletion was starting. Retry account deletion.",
          retryable: true,
        });
      }
    }
    await assertNoHostedStripeEffectClaimsForAccountDeletionTx({
      memberIds,
      prisma: tx,
    });
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

export async function assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx(
  input: {
    memberIds: readonly string[];
    prisma: Prisma.TransactionClient;
  },
): Promise<void> {
  const inFlightRefreshLeaseCount = await input.prisma.deviceConnection.count({
    where: {
      userId: buildStringInFilter(input.memberIds),
      OR: [
        { refreshLeaseExpiresAt: { not: null } },
        { refreshLeaseOwner: { not: null } },
        { refreshLeaseTokenVersion: { not: null } },
        {
          lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
          status: "reauthorization_required",
        },
      ],
    },
  });
  if (inFlightRefreshLeaseCount > 0) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "A connected-health credential refresh is still finishing. Retry account deletion.",
      retryable: true,
    });
  }
}

async function resolveHostedAccountDeletionRefreshLeases(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  request: Request;
}): Promise<void> {
  const candidateConnections = await input.prisma.deviceConnection.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      lastErrorCode: true,
      metadataJson: true,
      provider: true,
      refreshLeaseExpiresAt: true,
      refreshLeaseOwner: true,
      refreshLeaseTokenVersion: true,
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
      status: true,
      tokenVersion: true,
    },
    take: HOSTED_ACCOUNT_DELETION_REFRESH_LEASE_RECOVERY_LIMIT + 1,
    where: {
      userId: input.memberId,
      OR: [
        { refreshLeaseExpiresAt: { not: null } },
        { refreshLeaseOwner: { not: null } },
        { refreshLeaseTokenVersion: { not: null } },
        {
          lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
          status: "reauthorization_required",
        },
      ],
    },
  });
  const reconnectRequiredConnection = candidateConnections.find((record) =>
    record.status === "reauthorization_required"
    && record.lastErrorCode === "TOKEN_REFRESH_STATE_UNKNOWN"
  );
  if (reconnectRequiredConnection) {
    throw accountDeletionDeviceTokenRefreshRecoveryRequiredError(reconnectRequiredConnection);
  }
  const now = input.now.toISOString();
  const leasedConnections = candidateConnections.filter((record) =>
    classifyHostedTokenRefreshLease({ now, record }).status !== "none"
  );
  if (leasedConnections.length === 0) {
    return;
  }
  if (
    leasedConnections.length
    > HOSTED_ACCOUNT_DELETION_REFRESH_LEASE_RECOVERY_LIMIT
  ) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "Connected-health credential refresh state is still settling. Retry account deletion.",
      retryable: true,
    });
  }

  if (leasedConnections.some((record) =>
    classifyHostedTokenRefreshLease({ now, record }).status === "in_progress"
  )) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "A connected-health credential refresh is still finishing. Retry account deletion.",
      retryable: true,
    });
  }

  let controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane>;
  try {
    controlPlane = createHostedDeviceSyncControlPlane(input.request);
  } catch (error) {
    throw hostedOnboardingError({
      cause: error,
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "Connected-health credential refresh state could not be checked. Retry account deletion.",
      retryable: true,
    });
  }

  // Recover at most one stale lease per request. This keeps the destructive
  // preflight to one connection-lock transaction even when an account has
  // several stale connections; later retries handle the next connection.
  const [connection] = leasedConnections;
  if (!connection) {
    return;
  }
  const resolution = await resolveHostedRefreshLeaseBeforeDestructiveAction({
    connectionId: connection.id,
    now,
    store: controlPlane.store,
    userId: input.memberId,
  });
  if (resolution.status === "in_progress") {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "A connected-health credential refresh is still finishing. Retry account deletion.",
      retryable: true,
    });
  }
  if (resolution.status === "missing" || resolution.status === "none") {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
      httpStatus: 503,
      message: "A connected-health connection changed while account deletion was starting. Retry account deletion.",
      retryable: true,
    });
  }
  if (resolution.status === "stale_failed_closed") {
    throw accountDeletionDeviceTokenRefreshRecoveryRequiredError(connection);
  }
}

function accountDeletionDeviceTokenRefreshRecoveryRequiredError(connection: {
  id: string;
  metadataJson?: Prisma.JsonValue | null;
  provider: string;
  sources?: readonly {
    sourceProviderSlug: string;
    status: string;
  }[];
}) {
  const providerLabel = resolveDeviceConnectionProviderLabel(connection);
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_DEVICE_TOKEN_REFRESH_RECOVERY_REQUIRED",
    httpStatus: 409,
    message: `The ${providerLabel} credential refresh did not finish safely. Reconnect that source, then retry account deletion.`,
    retryable: false,
    details: {
      connectionId: connection.id,
      providerLabel,
    },
  });
}

function buildProviderAccessRemovalConfirmationToken(input: {
  ownerMemberId: string;
  sessions: readonly {
    consumedAt: Date | null;
    provider: string;
    state: string;
  }[];
}): string {
  return sha256Hex(JSON.stringify([
    input.ownerMemberId,
    [...input.sessions]
      .sort((left, right) => left.state.localeCompare(right.state))
      .map((session) => [
        session.state,
        session.consumedAt?.toISOString() ?? null,
        session.provider,
      ]),
  ]));
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

async function assertNoHostedStripeEffectClaimsForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const memberIdFilter = buildStringInFilter(input.memberIds);
  const [memberClaim, familyClaim] = await Promise.all([
    input.prisma.hostedMemberBillingRef.findFirst({
      select: { stripeEffectClaimId: true },
      where: {
        memberId: memberIdFilter,
        stripeEffectClaimId: { not: null },
      },
    }),
    input.prisma.hostedAccountGroupBillingRef.findFirst({
      select: { stripeEffectClaimId: true },
      where: {
        OR: [
          { stripeEffectBeneficiaryMemberId: memberIdFilter },
          {
            group: {
              OR: [
                { ownerMemberId: memberIdFilter },
                {
                  memberships: {
                    some: {
                      memberId: memberIdFilter,
                      status: "active",
                    },
                  },
                },
              ],
            },
          },
        ],
        stripeEffectClaimId: { not: null },
      },
    }),
  ]);
  assertHostedStripeEffectClaimAbsent(memberClaim?.stripeEffectClaimId);
  assertHostedStripeEffectClaimAbsent(familyClaim?.stripeEffectClaimId);
}

async function lockHostedFamilyClaimOwnersForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<string[]> {
  const ownerMemberIds = await listHostedFamilyClaimOwnerMemberIdsForAccountDeletionTx(
    input,
  );
  await lockHostedMembersForAccountDeletionTx({
    memberIds: ownerMemberIds,
    prisma: input.prisma,
    requiredMemberIds: ownerMemberIds,
  });
  return ownerMemberIds;
}

async function assertHostedFamilyClaimOwnersUnchangedForAccountDeletionTx(input: {
  expectedOwnerMemberIds: readonly string[];
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const currentOwnerMemberIds =
    await listHostedFamilyClaimOwnerMemberIdsForAccountDeletionTx(input);
  if (!haveSameStrings(currentOwnerMemberIds, input.expectedOwnerMemberIds)) {
    throwHostedAccountDeletionFamilyAuthorityChanged();
  }
}

async function listHostedFamilyClaimOwnerMemberIdsForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<string[]> {
  const memberIds = uniqueStrings(input.memberIds);
  if (memberIds.length === 0) {
    return [];
  }
  const memberIdFilter = buildStringInFilter(memberIds);
  const groups = await input.prisma.hostedAccountGroup.findMany({
    orderBy: { ownerMemberId: "asc" },
    select: { ownerMemberId: true },
    take: HOSTED_ACCOUNT_DELETION_MAX_FAMILY_CLAIM_OWNER_ROWS,
    where: {
      OR: [
        { ownerMemberId: memberIdFilter },
        {
          memberships: {
            some: {
              memberId: memberIdFilter,
              status: "active",
            },
          },
        },
        {
          billingRef: {
            is: {
              stripeEffectBeneficiaryMemberId: memberIdFilter,
            },
          },
        },
      ],
    },
  });
  if (groups.length === HOSTED_ACCOUNT_DELETION_MAX_FAMILY_CLAIM_OWNER_ROWS) {
    throwHostedAccountDeletionFamilyAuthorityChanged();
  }
  return uniqueStrings(groups.map((group) => group.ownerMemberId)).sort();
}

function throwHostedAccountDeletionFamilyAuthorityChanged(): never {
  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_FAMILY_AUTHORITY_CHANGED",
    httpStatus: 503,
    message: "Family billing changed while account deletion was starting. Retry account deletion.",
    retryable: true,
  });
}

function throwHostedAccountDeletionRuntimeSetChanged(): never {
  throw hostedOnboardingError({
    code: "ACCOUNT_DELETION_RUNTIME_SET_CHANGED",
    httpStatus: 503,
    message: "Your account changed during deletion. Retry so every hosted runtime is included.",
    retryable: true,
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
  currentDatabaseFingerprint: string;
  currentDeviceAuthorityFingerprint: string;
  expectedDatabaseFingerprint: string;
  expectedDeviceAuthorityFingerprint: string;
  prepared: PreparedHostedAccountDeletionCleanup;
  runtimeMemberIds: readonly string[];
}): void {
  if (!haveSameStrings(input.runtimeMemberIds, input.prepared.runtimeMemberIds)) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_RUNTIME_SET_CHANGED",
      httpStatus: 503,
      message: "Your account changed during deletion. Retry so every hosted runtime is included.",
      retryable: true,
    });
  }
  if (input.currentDatabaseFingerprint !== input.expectedDatabaseFingerprint) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_EXTERNAL_TARGET_SET_CHANGED",
      httpStatus: 503,
      message: "Your account changed during deletion. Retry so every provider record is included.",
      retryable: true,
    });
  }
  if (
    input.currentDeviceAuthorityFingerprint
    !== input.expectedDeviceAuthorityFingerprint
  ) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_DEVICE_AUTHORITY_SET_CHANGED",
      httpStatus: 503,
      message: "A connected-health authorization changed during deletion. Retry so it can be revoked.",
      retryable: true,
    });
  }
}

function buildDeviceConnectionAuthorityFingerprint(
  connections: readonly DeviceConnectionIdentity[],
): string {
  return JSON.stringify(
    [...connections]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((connection) => [
        connection.id,
        connection.provider,
        connection.providerAccountBlindIndex,
        connection.externalAccountIdEncrypted,
        connection.credentialKind,
        connection.providerConfigKey,
        connection.providerApplicationId,
        connection.providerApplicationRevision,
        connection.accessTokenEncrypted,
        connection.accessTokenExpiresAt instanceof Date
          ? connection.accessTokenExpiresAt.toISOString()
          : connection.accessTokenExpiresAt,
        connection.refreshTokenEncrypted,
        connection.keyVersion,
        connection.credentialMetadataJson,
        connection.metadataJson,
        connection.scopesJson,
        connection.status,
        connection.connectedAt instanceof Date
          ? connection.connectedAt.toISOString()
          : connection.connectedAt,
        connection.tokenVersion,
        connection.refreshLeaseOwner,
        connection.refreshLeaseExpiresAt instanceof Date
          ? connection.refreshLeaseExpiresAt.toISOString()
          : connection.refreshLeaseExpiresAt,
        connection.refreshLeaseTokenVersion,
        [...(connection.sources ?? [])]
          .sort((left, right) =>
            String(left.id).localeCompare(String(right.id))
          )
          .map((source) => [
            source.id,
            source.sourceInstanceKey,
            source.sourceProviderSlug,
            source.status,
          ]),
      ]),
  );
}

function buildStringInFilter(values: readonly string[]): string | { in: string[] } {
  const uniqueValues = uniqueStrings(values);
  if (uniqueValues.length === 1) {
    return uniqueValues[0]!;
  }
  return { in: uniqueValues };
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
  if (projectionIdentities.length > 0) {
    const liveDeliveries = await prisma.hostedLinqDelivery.findMany({
      select: { sourceRef: true },
      where: {
        OR: projectionIdentities.map((identity) => ({
          sourceRef: {
            startsWith: buildHostedLinqInviteSignupEffectId({
              memberId: identity.memberId,
              occurredAt: identity.dayUtc,
            }),
          },
        })),
        status: {
          in: ["attempted", "provider_dispatch_started", "accepted", "delivered"],
        },
        template: {
          in: ["invite_signup", "invite_signup_fallback"],
        },
      },
    });
    const liveIdentityKeys = new Set(
      readHostedLinqSignupProjectionIdentities(liveDeliveries).map(
        (identity) => `${identity.memberId}\0${identity.dayUtc}`,
      ),
    );
    const releasedIdentities = projectionIdentities.filter(
      (identity) => !liveIdentityKeys.has(`${identity.memberId}\0${identity.dayUtc}`),
    );
    if (releasedIdentities.length > 0) {
      const identityWhere = releasedIdentities.map((identity) => ({
        dayUtc: new Date(identity.dayUtc),
        memberId: identity.memberId,
      }));
      await prisma.hostedLinqDailyState.updateMany({
        data: { onboardingLinkSentAt: null },
        where: {
          ...(identityWhere.length === 1 ? identityWhere[0] : { OR: identityWhere }),
          onboardingLinkSentAt: { not: null },
        },
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
  // Retention owns when a started intent stops being provider-cleanup work.
  // Public bearer expiry must not make account deletion discard that owner.
  const writes = await input.prisma.hostedConnectedAppConnectIntent.findMany({
    select: { claimHash: true },
    take: 1,
    where: {
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

type HostedAccountDeletionCountRow = Record<string, bigint | number>;

function buildPostgresTextArray(values: readonly string[]): Prisma.Sql {
  return values.length === 0
    ? Prisma.sql`ARRAY[]::text[]`
    : Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]`;
}

async function readHostedAccountDeletionOwnerCounts(
  prisma: Prisma.TransactionClient,
  query: Prisma.Sql,
): Promise<HostedAccountDeletionCountRow> {
  const rows = await prisma.$queryRaw<HostedAccountDeletionCountRow[]>(query);
  if (rows.length !== 1) {
    throw new TypeError("Hosted account deletion owner did not return one count row.");
  }
  return rows[0]!;
}

function mergeHostedAccountDeletionOwnerCounts(
  counts: HostedAccountDataCounts,
  row: HostedAccountDeletionCountRow,
): void {
  for (const [key, value] of Object.entries(row)) {
    const count = typeof value === "bigint" ? Number(value) : value;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Hosted account deletion returned an invalid count for ${key}.`);
    }
    counts[key] = count;
  }
}

async function deleteHostedAccountPrismaRows(input: {
  connectionIdentities: readonly DeviceConnectionIdentity[];
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<HostedAccountDataCounts> {
  const memberIds = uniqueStrings(input.memberIds);
  const memberIdsSql = buildPostgresTextArray(memberIds);
  const signupPrefixesSql = buildPostgresTextArray(
    memberIds.map(buildHostedLinqInviteSignupEffectIdMemberPrefix),
  );
  const webhookTraceOwners = [
    ...new Map(
      input.connectionIdentities
        .filter((connection) => connection.providerAccountBlindIndex.length > 0)
        .map((connection) => [
          JSON.stringify([
            connection.provider,
            connection.providerAccountBlindIndex,
          ]),
          {
            provider: connection.provider,
            providerAccountBlindIndex: connection.providerAccountBlindIndex,
          },
        ] as const),
    ).values(),
  ];
  const webhookProvidersSql = buildPostgresTextArray(
    webhookTraceOwners.map((owner) => owner.provider),
  );
  const webhookBlindIndexesSql = buildPostgresTextArray(
    webhookTraceOwners.map((owner) => owner.providerAccountBlindIndex),
  );
  const counts: HostedAccountDataCounts = {};

  // Each raw statement is one dependency layer and must remain awaited in this
  // order. PostgreSQL executes sibling data-modifying CTEs without a defined order,
  // so a layer may contain only tables without a restrictive parent/child edge.
  mergeHostedAccountDeletionOwnerCounts(
    counts,
    await readHostedAccountDeletionOwnerCounts(
      input.prisma,
      Prisma.sql`
        /* hosted-account-deletion:dependents */
        WITH target_members(id) AS (
          SELECT unnest(${memberIdsSql})
        ),
        signup_prefixes(prefix) AS (
          SELECT unnest(${signupPrefixesSql})
        ),
        webhook_trace_owners(provider, provider_account_blind_index) AS (
          SELECT *
          FROM unnest(${webhookProvidersSql}, ${webhookBlindIndexesSql})
        ),
        target_account_groups(id) AS (
          SELECT account_group.id
          FROM hosted_account_group AS account_group
          JOIN target_members AS target
            ON target.id = account_group.owner_member_id
        ),
        target_groups(id) AS (
          SELECT hosted_group.id
          FROM hosted_group
          WHERE hosted_group.owner_member_id IN (SELECT id FROM target_members)
             OR hosted_group.runtime_member_id IN (SELECT id FROM target_members)
        ),
        counted_vault_shares AS (
          SELECT 1
          FROM hosted_vault_share AS share
          WHERE share.grantor_member_id IN (SELECT id FROM target_members)
             OR share.destination_member_id IN (SELECT id FROM target_members)
        ),
        counted_physical_notes AS (
          SELECT 1
          FROM hosted_physical_note AS note
          WHERE note.member_id IN (SELECT id FROM target_members)
        ),
        deleted_mailbox_payloads AS (
          DELETE FROM hosted_mailbox_payload AS payload
          WHERE payload.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_ingress_traces AS (
          DELETE FROM hosted_ingress_latency_trace AS trace
          WHERE trace.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_usage_credit_grants AS (
          DELETE FROM hosted_usage_credit_grant AS usage_grant
          WHERE EXISTS (
            SELECT 1
            FROM hosted_usage_credit_entry AS entry
            LEFT JOIN hosted_usage_credit_purchase AS purchase
              ON purchase.id = entry.purchase_id
            WHERE entry.id = usage_grant.entry_id
              AND (
                entry.beneficiary_member_id IN (SELECT id FROM target_members)
                OR purchase.beneficiary_member_id IN (SELECT id FROM target_members)
              )
          )
          RETURNING 1
        ),
        deleted_address_book_contacts AS (
          DELETE FROM hosted_address_book_contact AS contact
          WHERE contact.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_computer_handoffs AS (
          DELETE FROM hosted_computer_handoff AS handoff
          WHERE handoff.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_account_group_invites AS (
          DELETE FROM hosted_account_group_invite AS invite
          WHERE invite.accepted_by_member_id IN (SELECT id FROM target_members)
             OR invite.invited_by_member_id IN (SELECT id FROM target_members)
             OR invite.group_id IN (SELECT id FROM target_account_groups)
          RETURNING 1
        ),
        deleted_account_group_memberships AS (
          DELETE FROM hosted_account_group_membership AS membership
          WHERE membership.member_id IN (SELECT id FROM target_members)
             OR membership.group_id IN (SELECT id FROM target_account_groups)
          RETURNING 1
        ),
        deleted_account_group_billing_refs AS (
          DELETE FROM hosted_account_group_billing_ref AS billing_ref
          WHERE billing_ref.group_id IN (SELECT id FROM target_account_groups)
          RETURNING 1
        ),
        deleted_account_group_plan_capacity AS (
          DELETE FROM hosted_account_group_plan_capacity AS capacity
          WHERE capacity.group_id IN (SELECT id FROM target_account_groups)
          RETURNING 1
        ),
        deleted_group_disclosure_grants AS (
          DELETE FROM hosted_group_disclosure_grant AS disclosure_grant
          USING hosted_group_member AS membership
          WHERE membership.id = disclosure_grant.membership_id
            AND (
              membership.member_id IN (SELECT id FROM target_members)
              OR membership.group_id IN (SELECT id FROM target_groups)
          )
          RETURNING 1
        ),
        deleted_group_current_sender_clarifications AS (
          DELETE FROM hosted_group_current_sender_clarification AS clarification
          WHERE clarification.group_runtime_member_id IN (SELECT id FROM target_members)
             OR clarification.target_member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_thread_routes AS (
          DELETE FROM hosted_thread_route AS route
          WHERE route.container_member_id IN (SELECT id FROM target_members)
             OR EXISTS (
               SELECT 1
               FROM hosted_thread_container AS container
               WHERE container.member_id = route.container_member_id
                 AND container.owner_member_id IN (SELECT id FROM target_members)
             )
          RETURNING 1
        ),
        deleted_clinical_retrieval_requests AS (
          DELETE FROM clinical_record_retrieval_request AS request
          WHERE request.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_webhook_traces AS (
          DELETE FROM device_webhook_trace AS trace
          USING webhook_trace_owners AS owner
          WHERE trace.provider = owner.provider
            AND trace.provider_account_blind_index = owner.provider_account_blind_index
          RETURNING 1
        ),
        deleted_device_token_audits AS (
          DELETE FROM device_token_audit AS audit
          WHERE audit.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_capture_receipts AS (
          DELETE FROM device_sync_companion_capture_receipt AS receipt
          WHERE receipt.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_dirty_payloads AS (
          DELETE FROM device_sync_dirty_payload AS payload
          WHERE payload.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_dirty_connections AS (
          DELETE FROM device_sync_dirty_connection AS dirty_connection
          WHERE dirty_connection.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_sync_signals AS (
          DELETE FROM device_sync_signal AS signal
          WHERE signal.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_oauth_sessions AS (
          DELETE FROM device_oauth_session AS session
          WHERE session.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_linq_invite_deliveries AS (
          DELETE FROM hosted_linq_delivery AS delivery
          WHERE delivery.group_join_outreach_id IS NULL
            AND delivery.template IN ('invite_signup', 'invite_signup_fallback')
            AND EXISTS (
              SELECT 1
              FROM signup_prefixes
              WHERE starts_with(delivery.source_ref, signup_prefixes.prefix)
            )
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM counted_vault_shares)
            AS "prisma.hosted_vault_share",
          (SELECT count(*) FROM counted_physical_notes)
            AS "prisma.hosted_physical_note",
          (SELECT count(*) FROM deleted_mailbox_payloads)
            AS "prisma.hosted_mailbox_payload",
          (SELECT count(*) FROM deleted_ingress_traces)
            AS "prisma.hosted_ingress_latency_trace",
          (SELECT count(*) FROM deleted_usage_credit_grants)
            AS "prisma.hosted_usage_credit_grant",
          (SELECT count(*) FROM deleted_address_book_contacts)
            AS "prisma.hosted_address_book_contact",
          (SELECT count(*) FROM deleted_computer_handoffs)
            AS "prisma.hosted_computer_handoff",
          (SELECT count(*) FROM deleted_account_group_invites)
            AS "prisma.hosted_account_group_invite",
          (SELECT count(*) FROM deleted_account_group_memberships)
            AS "prisma.hosted_account_group_membership",
          (SELECT count(*) FROM deleted_account_group_billing_refs)
            AS "prisma.hosted_account_group_billing_ref",
          (SELECT count(*) FROM deleted_account_group_plan_capacity)
            AS "prisma.hosted_account_group_plan_capacity",
          (SELECT count(*) FROM deleted_group_disclosure_grants)
            AS "prisma.hosted_group_disclosure_grant",
          (SELECT count(*) FROM deleted_group_current_sender_clarifications)
            AS "prisma.hosted_group_current_sender_clarification",
          (SELECT count(*) FROM deleted_thread_routes)
            AS "prisma.hosted_thread_route",
          (SELECT count(*) FROM deleted_clinical_retrieval_requests)
            AS "prisma.clinical_record_retrieval_request",
          (SELECT count(*) FROM deleted_device_webhook_traces)
            AS "prisma.device_webhook_trace",
          (SELECT count(*) FROM deleted_device_token_audits)
            AS "prisma.device_token_audit",
          (SELECT count(*) FROM deleted_device_capture_receipts)
            AS "prisma.device_sync_companion_capture_receipt",
          (SELECT count(*) FROM deleted_device_dirty_payloads)
            AS "prisma.device_sync_dirty_payload",
          (SELECT count(*) FROM deleted_device_dirty_connections)
            AS "prisma.device_sync_dirty_connection",
          (SELECT count(*) FROM deleted_device_sync_signals)
            AS "prisma.device_sync_signal",
          (SELECT count(*) FROM deleted_device_oauth_sessions)
            AS "prisma.device_oauth_session",
          (SELECT count(*) FROM deleted_linq_invite_deliveries)
            AS "prisma.hosted_linq_invite_delivery"
      `,
    ),
  );

  mergeHostedAccountDeletionOwnerCounts(
    counts,
    await readHostedAccountDeletionOwnerCounts(
      input.prisma,
      Prisma.sql`
        /* hosted-account-deletion:intermediate */
        WITH target_members(id) AS (
          SELECT unnest(${memberIdsSql})
        ),
        target_groups(id) AS (
          SELECT hosted_group.id
          FROM hosted_group
          WHERE hosted_group.owner_member_id IN (SELECT id FROM target_members)
             OR hosted_group.runtime_member_id IN (SELECT id FROM target_members)
        ),
        deleted_mailbox_items AS (
          DELETE FROM hosted_mailbox_item AS item
          WHERE item.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_usage_credit_entries AS (
          DELETE FROM hosted_usage_credit_entry AS entry
          WHERE entry.beneficiary_member_id IN (SELECT id FROM target_members)
             OR EXISTS (
               SELECT 1
               FROM hosted_usage_credit_purchase AS purchase
               WHERE purchase.id = entry.purchase_id
                 AND purchase.beneficiary_member_id IN (SELECT id FROM target_members)
             )
          RETURNING 1
        ),
        deleted_address_book_projections AS (
          DELETE FROM hosted_address_book_projection AS projection
          WHERE projection.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_computer_runs AS (
          DELETE FROM hosted_computer_run AS run
          WHERE run.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_group_disclosure_permissions AS (
          DELETE FROM hosted_group_disclosure_permission AS permission
          WHERE permission.group_id IN (SELECT id FROM target_groups)
          RETURNING 1
        ),
        deleted_group_members AS (
          DELETE FROM hosted_group_member AS membership
          WHERE membership.member_id IN (SELECT id FROM target_members)
             OR membership.group_id IN (SELECT id FROM target_groups)
          RETURNING 1
        ),
        deleted_clinical_retrieval_runs AS (
          DELETE FROM clinical_record_retrieval_run AS run
          WHERE run.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_connections AS (
          DELETE FROM device_connection AS connection
          WHERE connection.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM deleted_mailbox_items)
            AS "prisma.hosted_mailbox_item",
          (SELECT count(*) FROM deleted_usage_credit_entries)
            AS "prisma.hosted_usage_credit_entry",
          (SELECT count(*) FROM deleted_address_book_projections)
            AS "prisma.hosted_address_book_projection",
          (SELECT count(*) FROM deleted_computer_runs)
            AS "prisma.hosted_computer_run",
          (SELECT count(*) FROM deleted_group_disclosure_permissions)
            AS "prisma.hosted_group_disclosure_permission",
          (SELECT count(*) FROM deleted_group_members)
            AS "prisma.hosted_group_member",
          (SELECT count(*) FROM deleted_clinical_retrieval_runs)
            AS "prisma.clinical_record_retrieval_run",
          (SELECT count(*) FROM deleted_device_connections)
            AS "prisma.device_connection"
      `,
    ),
  );

  mergeHostedAccountDeletionOwnerCounts(
    counts,
    await readHostedAccountDeletionOwnerCounts(
      input.prisma,
      Prisma.sql`
        /* hosted-account-deletion:referrals-purchases */
        WITH target_members(id) AS (
          SELECT unnest(${memberIdsSql})
        ),
        anonymized_rewarded_referrals AS (
          UPDATE hosted_usage_referral AS referral
          SET first_human_message_at = NULL,
              human_message_count = 0,
              introduced_member_id = NULL,
              last_human_message_at = NULL,
              non_referrer_message_count = 0,
              observed_event_keys_json = NULL,
              observed_speaker_keys_json = NULL,
              referrer_member_id = NULL,
              referrer_subject_key = NULL,
              source_conversation_json = NULL,
              target_container_member_id = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE referral.status = 'rewarded'
            AND referral.beneficiary_member_id NOT IN (SELECT id FROM target_members)
            AND (
              referral.beneficiary_member_id IN (SELECT id FROM target_members)
              OR referral.introduced_member_id IN (SELECT id FROM target_members)
              OR referral.referrer_member_id IN (SELECT id FROM target_members)
              OR referral.target_container_member_id IN (SELECT id FROM target_members)
            )
          RETURNING 1
        ),
        deleted_usage_referrals AS (
          DELETE FROM hosted_usage_referral AS referral
          WHERE referral.beneficiary_member_id IN (SELECT id FROM target_members)
             OR (
               referral.status <> 'rewarded'
               AND (
                 referral.beneficiary_member_id IN (SELECT id FROM target_members)
                 OR referral.introduced_member_id IN (SELECT id FROM target_members)
                 OR referral.referrer_member_id IN (SELECT id FROM target_members)
                 OR referral.target_container_member_id IN (SELECT id FROM target_members)
               )
             )
          RETURNING 1
        ),
        deleted_usage_credit_purchases AS (
          DELETE FROM hosted_usage_credit_purchase AS purchase
          WHERE purchase.beneficiary_member_id IN (SELECT id FROM target_members)
          RETURNING 1
        )
        SELECT
          (
            (SELECT count(*) FROM anonymized_rewarded_referrals)
            + (SELECT count(*) FROM deleted_usage_referrals)
          ) AS "prisma.hosted_usage_referral",
          (SELECT count(*) FROM deleted_usage_credit_purchases)
            AS "prisma.hosted_usage_credit_purchase"
      `,
    ),
  );

  // Pre-member group-join outreach is keyed by the participant's phone and by
  // the group, not by a member id, so it is resolved before the identity rows
  // and the owned groups are deleted below. Running after either one would strand
  // the encrypted phone, its group association, or the provider correlation that
  // only the outreach id can find.
  const groupJoinOutreachDeletion =
    await deleteHostedGroupJoinOutreachRowsForMembers(
      input.prisma,
      buildStringInFilter(memberIds),
    );
  counts["prisma.hosted_group_join_outreach"] =
    groupJoinOutreachDeletion.outreachCount;
  counts["prisma.hosted_group_join_outreach_delivery"] =
    groupJoinOutreachDeletion.deliveryCount;

  mergeHostedAccountDeletionOwnerCounts(
    counts,
    await readHostedAccountDeletionOwnerCounts(
      input.prisma,
      Prisma.sql`
        /* hosted-account-deletion:owners */
        WITH target_members(id) AS (
          SELECT unnest(${memberIdsSql})
        ),
        target_account_groups(id) AS (
          SELECT account_group.id
          FROM hosted_account_group AS account_group
          JOIN target_members AS target
            ON target.id = account_group.owner_member_id
        ),
        target_groups(id) AS (
          SELECT hosted_group.id
          FROM hosted_group
          WHERE hosted_group.owner_member_id IN (SELECT id FROM target_members)
             OR hosted_group.runtime_member_id IN (SELECT id FROM target_members)
        ),
        deleted_mailbox_lane_counters AS (
          DELETE FROM hosted_mailbox_lane_counter AS counter
          WHERE counter.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_crypto_audits AS (
          DELETE FROM hosted_user_crypto_audit AS audit
          WHERE audit.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_crypto_envelopes AS (
          DELETE FROM hosted_user_crypto_envelope AS envelope
          WHERE envelope.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_group_sponsorship_authorizations AS (
          DELETE FROM hosted_group_sponsorship_authorization AS sponsorship_authorization
          WHERE sponsorship_authorization.beneficiary_member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_ai_usage AS (
          DELETE FROM hosted_ai_usage AS usage
          WHERE usage.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_ai_usage_periods AS (
          DELETE FROM hosted_ai_usage_period AS usage_period
          WHERE usage_period.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_product_feedback AS (
          DELETE FROM hosted_product_feedback AS feedback
          WHERE feedback.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_codex_connections AS (
          DELETE FROM hosted_codex_auth_connection AS connection
          WHERE connection.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_inference_connections AS (
          DELETE FROM hosted_inference_connection AS connection
          WHERE connection.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_linq_daily_states AS (
          DELETE FROM hosted_linq_daily_state AS daily_state
          WHERE daily_state.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_invites AS (
          DELETE FROM hosted_invite AS invite
          WHERE invite.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_consent_events AS (
          DELETE FROM hosted_consent_event AS consent_event
          WHERE consent_event.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_consent_grants AS (
          DELETE FROM hosted_consent_grant AS consent_grant
          WHERE consent_grant.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_workspaces AS (
          DELETE FROM hosted_workspace AS workspace
          WHERE workspace.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_phone_calls AS (
          DELETE FROM hosted_phone_call AS phone_call
          WHERE phone_call.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_member_email_authorizations AS (
          DELETE FROM hosted_member_email_authorization AS email_authorization
          WHERE email_authorization.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_subscription_checkouts AS (
          DELETE FROM hosted_member_subscription_checkout AS checkout
          WHERE checkout.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_member_billing_refs AS (
          DELETE FROM hosted_member_billing_ref AS billing_ref
          WHERE billing_ref.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_account_groups AS (
          DELETE FROM hosted_account_group AS account_group
          WHERE account_group.id IN (SELECT id FROM target_account_groups)
          RETURNING 1
        ),
        deleted_groups AS (
          DELETE FROM hosted_group AS hosted_group
          WHERE hosted_group.id IN (SELECT id FROM target_groups)
          RETURNING 1
        ),
        deleted_pending_group_setups AS (
          DELETE FROM hosted_pending_group_setup AS pending_setup
          WHERE pending_setup.owner_member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_member_routing AS (
          DELETE FROM hosted_member_routing AS routing
          WHERE routing.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_sensitive_action_challenges AS (
          DELETE FROM hosted_sensitive_action_challenge AS challenge
          WHERE challenge.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_web_sessions AS (
          DELETE FROM hosted_web_session AS session
          WHERE session.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_member_identities AS (
          DELETE FROM hosted_member_identity AS identity
          WHERE identity.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_thread_containers AS (
          DELETE FROM hosted_thread_container AS container
          WHERE container.member_id IN (SELECT id FROM target_members)
             OR container.owner_member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_connected_app_intents AS (
          DELETE FROM hosted_connected_app_connect_intent AS intent
          WHERE intent.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_connected_app_sessions AS (
          DELETE FROM hosted_connected_apps_session AS session
          WHERE session.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_clinical_oauth_sessions AS (
          DELETE FROM clinical_record_oauth_session AS session
          WHERE session.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_clinical_connect_intents AS (
          DELETE FROM clinical_record_connect_intent AS intent
          WHERE intent.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_clinical_connections AS (
          DELETE FROM clinical_record_connection AS connection
          WHERE connection.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_connect_intents AS (
          DELETE FROM device_connect_intent AS intent
          WHERE intent.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_agent_sessions AS (
          DELETE FROM device_agent_session AS session
          WHERE session.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_browser_nonces AS (
          DELETE FROM device_browser_assertion_nonce AS nonce
          WHERE nonce.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_web_internal_nonces AS (
          DELETE FROM hosted_web_internal_request_nonce AS nonce
          WHERE nonce.user_id IN (SELECT id FROM target_members)
          RETURNING 1
        ),
        deleted_device_provider_applications AS (
          DELETE FROM device_provider_application AS application
          WHERE application.member_id IN (SELECT id FROM target_members)
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM deleted_mailbox_lane_counters)
            AS "prisma.hosted_mailbox_lane_counter",
          (SELECT count(*) FROM deleted_crypto_audits)
            AS "prisma.hosted_user_crypto_audit",
          (SELECT count(*) FROM deleted_crypto_envelopes)
            AS "prisma.hosted_user_crypto_envelope",
          (SELECT count(*) FROM deleted_group_sponsorship_authorizations)
            AS "prisma.hosted_group_sponsorship_authorization",
          (SELECT count(*) FROM deleted_ai_usage)
            AS "prisma.hosted_ai_usage",
          (SELECT count(*) FROM deleted_ai_usage_periods)
            AS "prisma.hosted_ai_usage_period",
          (SELECT count(*) FROM deleted_product_feedback)
            AS "prisma.hosted_product_feedback",
          (SELECT count(*) FROM deleted_codex_connections)
            AS "prisma.hosted_codex_auth_connection",
          (SELECT count(*) FROM deleted_inference_connections)
            AS "prisma.hosted_inference_connection",
          (SELECT count(*) FROM deleted_linq_daily_states)
            AS "prisma.hosted_linq_daily_state",
          (SELECT count(*) FROM deleted_invites)
            AS "prisma.hosted_invite",
          (SELECT count(*) FROM deleted_consent_events)
            AS "prisma.hosted_consent_event",
          (SELECT count(*) FROM deleted_consent_grants)
            AS "prisma.hosted_consent_grant",
          (SELECT count(*) FROM deleted_workspaces)
            AS "prisma.hosted_workspace",
          (SELECT count(*) FROM deleted_phone_calls)
            AS "prisma.hosted_phone_call",
          (SELECT count(*) FROM deleted_member_email_authorizations)
            AS "prisma.hosted_member_email_authorization",
          (SELECT count(*) FROM deleted_subscription_checkouts)
            AS "prisma.hosted_member_subscription_checkout",
          (SELECT count(*) FROM deleted_member_billing_refs)
            AS "prisma.hosted_member_billing_ref",
          (SELECT count(*) FROM deleted_account_groups)
            AS "prisma.hosted_account_group",
          (SELECT count(*) FROM deleted_groups)
            AS "prisma.hosted_group",
          (SELECT count(*) FROM deleted_pending_group_setups)
            AS "prisma.hosted_pending_group_setup",
          (SELECT count(*) FROM deleted_member_routing)
            AS "prisma.hosted_member_routing",
          (SELECT count(*) FROM deleted_sensitive_action_challenges)
            AS "prisma.hosted_sensitive_action_challenge",
          (SELECT count(*) FROM deleted_web_sessions)
            AS "prisma.hosted_web_session",
          (SELECT count(*) FROM deleted_member_identities)
            AS "prisma.hosted_member_identity",
          (SELECT count(*) FROM deleted_thread_containers)
            AS "prisma.hosted_thread_container",
          (SELECT count(*) FROM deleted_connected_app_intents)
            AS "prisma.hosted_connected_app_connect_intent",
          (SELECT count(*) FROM deleted_connected_app_sessions)
            AS "prisma.hosted_connected_apps_session",
          (SELECT count(*) FROM deleted_clinical_oauth_sessions)
            AS "prisma.clinical_record_oauth_session",
          (SELECT count(*) FROM deleted_clinical_connect_intents)
            AS "prisma.clinical_record_connect_intent",
          (SELECT count(*) FROM deleted_clinical_connections)
            AS "prisma.clinical_record_connection",
          (SELECT count(*) FROM deleted_device_connect_intents)
            AS "prisma.device_connect_intent",
          (SELECT count(*) FROM deleted_device_agent_sessions)
            AS "prisma.device_agent_session",
          (SELECT count(*) FROM deleted_device_browser_nonces)
            AS "prisma.device_browser_assertion_nonce",
          (SELECT count(*) FROM deleted_web_internal_nonces)
            AS "prisma.hosted_web_internal_request_nonce",
          (SELECT count(*) FROM deleted_device_provider_applications)
            AS "prisma.device_provider_application"
      `,
    ),
  );

  mergeHostedAccountDeletionOwnerCounts(
    counts,
    await readHostedAccountDeletionOwnerCounts(
      input.prisma,
      Prisma.sql`
        /* hosted-account-deletion:member */
        WITH target_members(id) AS (
          SELECT unnest(${memberIdsSql})
        ),
        deleted_members AS (
          DELETE FROM hosted_member AS member
          WHERE member.id IN (SELECT id FROM target_members)
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM deleted_members)
            AS "prisma.hosted_member"
      `,
    ),
  );

  return counts;
}

export async function lockDeviceConnectionAuthorityRowsForAccountDeletionTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  // Lock the parent rows first. Besides serializing current connection
  // credential writers, this blocks a new source FK from appearing between
  // the source lock and the exact authority snapshot below.
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    /* device-account-deletion:connection-authority-lock */
    SELECT connection.id
    FROM device_connection AS connection
    WHERE connection.user_id = ${input.memberId}
    ORDER BY connection.id ASC
    FOR UPDATE OF connection
  `;
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    /* device-account-deletion:source-authority-lock */
    SELECT source.id
    FROM device_connection_source AS source
    JOIN device_connection AS connection
      ON connection.id = source.connection_id
    WHERE connection.user_id = ${input.memberId}
    ORDER BY source.id ASC
    FOR UPDATE OF source
  `;
}

async function listDeviceConnectionIdentities(input: {
  memberId: string;
  prisma: HostedAccountDataPrisma;
}): Promise<DeviceConnectionIdentity[]> {
  return input.prisma.deviceConnection.findMany({
    select: {
      accessTokenEncrypted: true,
      accessTokenExpiresAt: true,
      connectedAt: true,
      credentialKind: true,
      credentialMetadataJson: true,
      externalAccountIdEncrypted: true,
      id: true,
      keyVersion: true,
      metadataJson: true,
      provider: true,
      providerApplicationId: true,
      providerApplicationRevision: true,
      providerAccountBlindIndex: true,
      providerConfigKey: true,
      refreshLeaseExpiresAt: true,
      refreshLeaseOwner: true,
      refreshLeaseTokenVersion: true,
      refreshTokenEncrypted: true,
      scopesJson: true,
      sources: {
        orderBy: [
          { status: "asc" },
          { sourceProviderSlug: "asc" },
        ],
        select: {
          id: true,
          sourceInstanceKey: true,
          sourceProviderSlug: true,
          status: true,
        },
      },
      status: true,
      tokenVersion: true,
    },
    where: { userId: input.memberId },
  });
}

async function lockHostedMembersForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
  requiredMemberIds?: readonly string[];
}): Promise<void> {
  const memberIds = uniqueStrings(input.memberIds).sort();
  if (memberIds.length === 0) {
    return;
  }

  const rows = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id IN (${Prisma.join(memberIds)})
    ORDER BY id ASC
    FOR UPDATE
  `;
  const lockedMemberIds = new Set(rows.map((row) => row.id));
  const missingRequiredMember = uniqueStrings(input.requiredMemberIds ?? [])
    .sort()
    .find((memberId) => !lockedMemberIds.has(memberId));
  if (missingRequiredMember) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
}

async function lockHostedComputerUseRowsForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const memberIds = uniqueStrings(input.memberIds).sort();
  if (memberIds.length === 0) {
    return;
  }

  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_run
    WHERE member_id IN (${Prisma.join(memberIds)})
    ORDER BY member_id ASC, id ASC
    FOR UPDATE
  `;
  await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_computer_handoff
    WHERE member_id IN (${Prisma.join(memberIds)})
    ORDER BY member_id ASC, id ASC
    FOR UPDATE
  `;
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

  const results: HostedAccountProviderRevocationResult[] = [];
  let controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane> | null = null;
  let controlPlaneInitializationAttempted = false;
  let controlPlaneInitializationError: unknown = null;
  let registry: ReturnType<typeof createHostedDeviceSyncRegistry> | null = null;
  for (const connection of input.connections) {
    // This canonical raw field is the sole cleanup authority. Do not hydrate an
    // account or resolve a provider application after confirmed release.
    if (connection.credentialKind === "none") {
      results.push({
        connectionId: connection.id,
        errorCode: null,
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "not_needed",
        warningCode: null,
      });
      continue;
    }

    if (!controlPlaneInitializationAttempted) {
      controlPlaneInitializationAttempted = true;
      try {
        controlPlane = createHostedDeviceSyncControlPlane(input.request);
      } catch (error) {
        controlPlaneInitializationError = error;
      }
    }
    if (!controlPlane) {
      results.push({
        connectionId: connection.id,
        errorCode: safeErrorCode(controlPlaneInitializationError),
        providerLabel: resolveDeviceConnectionProviderLabel(connection),
        status: "failed",
        warningCode: null,
      });
      continue;
    }

    try {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.memberId,
        connection.id,
      );

      if (!storedAccount) {
        // Any non-none raw kind owns cleanup authority. Missing hydration is a
        // corrupt/incomplete credential, never proof of provider revocation.
        results.push({
          connectionId: connection.id,
          errorCode: "CONNECTION_SECRET_MISSING",
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: "failed",
          warningCode: null,
        });
        continue;
      }

      const cleanup = await resolveHostedDeviceSyncConnectionCleanup({
        connectionId: connection.id,
        memberId: input.memberId,
        prisma: controlPlane.store.prisma,
        provider: connection.provider,
        resolveSharedRegistry: () =>
          (registry ??= createHostedDeviceSyncRegistry(process.env)),
      });
      const revokeAccess = cleanup.revokeAccessOverride === undefined
        ? cleanup.registry?.get(connection.provider)?.connectionHandler?.revokeAccess
        : cleanup.revokeAccessOverride ?? undefined;

      if (!revokeAccess) {
        results.push({
          connectionId: connection.id,
          errorCode: cleanup.warning?.code ?? "PROVIDER_REVOKE_NOT_CONFIGURED",
          providerLabel: resolveDeviceConnectionProviderLabel(connection),
          status: "failed",
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
  now: Date;
  prisma: HostedAccountDataPrisma;
}): Promise<HostedAccountProviderRevocationResult[]> {
  const inFlightIntents = await listInFlightConnectedAppIntentsForDeletion(input);
  const incompleteIntentCount = inFlightIntents.filter(
    (intent) => !intent.connectedAccountId,
  ).length;
  if (incompleteIntentCount > 0) {
    return [{
      connectionId: "composio_connected_app_connection_in_progress",
      errorCode: incompleteIntentCount === 1
        ? "CONNECTED_APP_CONNECTION_IN_PROGRESS"
        : "CONNECTED_APP_CONNECTIONS_IN_PROGRESS",
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
  now: Date;
  prisma: HostedAccountDataPrisma;
}): Promise<Array<{
  alias: string | null;
  connectedAccountId: string | null;
  toolkit: string;
}>> {
  const ownerCutoff = hostedConnectedAppStartedIntentOwnerCutoff(input.now);
  const intents = await input.prisma.hostedConnectedAppConnectIntent.findMany({
    orderBy: [
      { expiresAt: "asc" },
      { claimHash: "asc" },
    ],
    select: {
      alias: true,
      connectedAccountId: true,
      toolkit: true,
    },
    take: HOSTED_ACCOUNT_DELETION_CONNECTED_APP_INTENT_LIMIT + 1,
    where: {
      completedAt: null,
      expiresAt: { gt: ownerCutoff },
      memberId: input.memberId,
      startedAt: { not: null },
    },
  });
  if (intents.length > HOSTED_ACCOUNT_DELETION_CONNECTED_APP_INTENT_LIMIT) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG",
      details: {
        limit: HOSTED_ACCOUNT_DELETION_CONNECTED_APP_INTENT_LIMIT,
      },
      httpStatus: 503,
      message: HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE,
      retryable: true,
    });
  }
  return intents;
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

  if (failures.some((failure) =>
    failure.errorCode === "CONNECTED_APP_CONNECTIONS_IN_PROGRESS"
  )) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG",
      httpStatus: 503,
      message: HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE,
      retryable: true,
    });
  }

  if (failures.some((failure) =>
    failure.errorCode === "CONNECTED_APP_CONNECTION_IN_PROGRESS"
  )) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS",
      httpStatus: 503,
      message: HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE,
      retryable: true,
    });
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

function safeErrorCode(error: unknown): string {
  if (isDeviceSyncError(error)) {
    return sanitizeHostedRuntimeErrorCode(error.code) ?? "DEVICE_SYNC_ERROR";
  }

  if (error instanceof Error) {
    return sanitizeHostedRuntimeErrorCode(error.name) ?? "ERROR";
  }

  return "UNKNOWN_ERROR";
}
