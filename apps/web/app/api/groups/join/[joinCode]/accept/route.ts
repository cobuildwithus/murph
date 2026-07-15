import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  buildHostedVaultShareProjectionScopeKey,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
} from "@/src/lib/hosted-groups/group-newsletter";
import {
  materializePendingHostedGroupJoinConfirmationsBestEffort,
  signalHostedGroupJoinConfirmationRuntimeBestEffort,
} from "@/src/lib/hosted-groups/group-join-confirmation";
import { acceptHostedGroupJoinCodeTx } from "@/src/lib/hosted-groups/group-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import {
  signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 16_384;

const SELECTABLE_SCOPE_KEYS = new Set(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) =>
    buildHostedVaultShareProjectionScopeKey(scope)
  ),
);

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ joinCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const joinCode = await resolveDecodedRouteParam(context.params, "joinCode");
  const body = await readOptionalJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  const expectedMembershipId = parseExpectedMembershipId(body);
  const selectedVaultShareProjectionScopes = parseSelectedVaultShareProjectionScopes(
    body.selectedVaultShareProjectionScopes ?? body.selectedVaultShareProjectionKinds,
  );

  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => acceptHostedGroupJoinCodeTx({
    confirmationPublicBaseUrl: resolveHostedPublicBaseUrl(),
    expectedMembershipId,
    joinCode,
    memberId: auth.member.id,
    now,
    selectedVaultShareProjectionScopes,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  const {
    joinConfirmationSignal,
    vaultShareCleanupSignals,
    ...responseResult
  } = result;

  const postCommitDeadlineMs = createHostedPostCommitDeadline(undefined);
  if (joinConfirmationSignal) {
    await signalHostedGroupJoinConfirmationRuntimeBestEffort({
      ...joinConfirmationSignal,
      prisma,
      signal: request.signal,
      timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
    });
  }
  await materializePendingHostedGroupJoinConfirmationsBestEffort({
    memberId: auth.member.id,
    membershipId: responseResult.membershipId,
    prisma,
    signal: request.signal,
    timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
  });

  if (result.grantedVaultShareProjectionKinds.length > 0) {
    await runHostedGroupJoinPostCommitBestEffort({
      deadlineMs: postCommitDeadlineMs,
      operation: () => signalHostedRuntimeMaintenanceRuntime({ userId: auth.member.id }),
      signal: request.signal,
    });
  }

  if (result.grantedVaultShareProjectionKinds.includes("group-email.v0")) {
    await runHostedGroupJoinPostCommitBestEffort({
      deadlineMs: postCommitDeadlineMs,
      operation: () => enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
        groupId: result.groupId,
        memberId: auth.member.id,
        prisma,
      }),
      signal: request.signal,
    });
  }
  await signalMailboxAppendRuntimesBestEffort({
    deadlineMs: postCommitDeadlineMs,
    signal: request.signal,
    signals: vaultShareCleanupSignals,
  });

  return jsonOk({ ok: true, ...responseResult });
});

async function signalMailboxAppendRuntimesBestEffort(input: {
  deadlineMs: number;
  signal?: AbortSignal;
  signals: readonly { mailboxItemId: string; memberId: string }[];
}): Promise<void> {
  await Promise.all(input.signals.map((mailboxSignal) =>
    runHostedGroupJoinPostCommitBestEffort({
      deadlineMs: input.deadlineMs,
      operation: () => signalHostedMailboxAppendRuntime({
        expectedUserId: mailboxSignal.memberId,
        mailboxItemId: mailboxSignal.mailboxItemId,
      }),
      signal: input.signal,
    })
  ));
}

async function runHostedGroupJoinPostCommitBestEffort(input: {
  deadlineMs: number;
  operation: () => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: input.deadlineMs,
      operation: input.operation,
      signal: input.signal,
    });
  } catch {
    // The durable join, grants, and mailbox items remain available for a later wake.
  }
}

function parseSelectedVaultShareProjectionScopes(value: unknown): HostedVaultShareProjectionScope[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SELECTED_PERMISSIONS_INVALID",
      httpStatus: 400,
      message: "Selected group permissions must be a list.",
    });
  }
  const selected = new Map<string, HostedVaultShareProjectionScope>();
  for (const entry of value) {
    let scope: HostedVaultShareProjectionScope;
    try {
      scope = parseHostedVaultShareProjectionScope(
        entry,
        "Selected group permission",
      );
    } catch {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SELECTED_PERMISSION_UNSUPPORTED",
        httpStatus: 400,
        message: "One of the selected group permissions is not supported.",
      });
    }
    const scopeKey = buildHostedVaultShareProjectionScopeKey(scope);
    if (!SELECTABLE_SCOPE_KEYS.has(scopeKey)) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SELECTED_PERMISSION_UNSUPPORTED",
        httpStatus: 400,
        message: "One of the selected group permissions is not supported.",
      });
    }
    selected.set(scopeKey, scope);
    if (selected.size > HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SELECTED_PERMISSIONS_TOO_MANY",
        httpStatus: 400,
        message: "Too many group permissions were selected.",
      });
    }
  }
  return HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.filter((scope) =>
    selected.has(buildHostedVaultShareProjectionScopeKey(scope))
  );
}

function parseExpectedMembershipId(body: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, "expectedMembershipId")) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_MEMBERSHIP_CHANGED",
      httpStatus: 409,
      message: "Your group membership changed. Reload this page and try again.",
      retryable: false,
    });
  }

  const value = body.expectedMembershipId;
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_MEMBERSHIP_ID_INVALID",
      httpStatus: 400,
      message: "Group membership id must be a non-empty string or null.",
      retryable: false,
    });
  }
  return value.trim();
}
