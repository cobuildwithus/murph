import "server-only";

import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { extractHostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import {
  buildJoinInvitePreviewStatus,
  parseJoinInvitePreviewStage,
} from "./join-invite-preview";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { getHostedPrivySession } from "@/src/lib/hosted-onboarding/hosted-session";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedConsentStatus,
  type HostedConsentStatus,
} from "@/src/lib/legal/consent";
import {
  hasResolvedHostedInviteVerification,
  shouldGateJoinInviteStatusWithLaunchConsent,
} from "./join-invite-state";

export type JoinInviteLaunchConsentState =
  | {
      gateActive: false;
      initialStatus: HostedConsentStatus | null;
      status: "granted" | "not_required" | "preview";
    }
  | {
      gateActive: true;
      initialStatus: HostedConsentStatus | null;
      status: "required" | "error";
      errorMessage?: string;
    };

export interface JoinInvitePageModel {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  launchConsent: JoinInviteLaunchConsentState;
  preview: boolean;
  status: HostedInviteStatusPayload;
  telegramAccountForMessagingSetup: JoinInviteTelegramAccountSeed | null;
}

export interface JoinInviteTelegramAccountSeed {
  telegramUserId: string;
  username: string | null;
}

export async function buildJoinInvitePageModel(input: {
  inviteCode: string;
  preview?: string | readonly string[] | null;
}): Promise<JoinInvitePageModel> {
  const previewStage =
    process.env.NODE_ENV !== "production"
      ? parseJoinInvitePreviewStage(readSingleSearchParam(input.preview))
      : null;

  if (previewStage) {
    const status = buildJoinInvitePreviewStatus(previewStage, input.inviteCode);
    return {
      awaitingInviteSessionResolution: false,
      inviteCode: input.inviteCode,
      launchConsent: {
        gateActive: false,
        initialStatus: null,
        status: "preview",
      },
      preview: true,
      status,
      telegramAccountForMessagingSetup: null,
    };
  }

  const [authSnapshot, freshPrivySession] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getHostedPrivySession().catch(() => null),
  ]);
  const status = await getHostedInviteStatus({
    authenticatedMember: authSnapshot.authenticatedMember,
    inviteCode: input.inviteCode,
  });
  const launchConsent = await resolveJoinInviteLaunchConsent({
    memberId: authSnapshot.authenticatedMember?.id ?? null,
    status,
  });
  const telegramAccountForMessagingSetup =
    !launchConsent.gateActive
    && status.stage === "checkout"
    && status.messagingSetupRequired
      ? sanitizeJoinInviteTelegramAccountSeed(extractHostedPrivyTelegramAccount({
          linkedAccounts: freshPrivySession?.linkedAccounts ?? [],
        }))
      : null;

  return {
    awaitingInviteSessionResolution: !hasResolvedHostedInviteVerification(status),
    inviteCode: input.inviteCode,
    launchConsent,
    preview: false,
    status,
    telegramAccountForMessagingSetup,
  };
}

function sanitizeJoinInviteTelegramAccountSeed(
  account: ReturnType<typeof extractHostedPrivyTelegramAccount>,
): JoinInviteTelegramAccountSeed | null {
  if (!account) {
    return null;
  }

  return {
    telegramUserId: account.telegramUserId,
    username: account.username,
  };
}

async function resolveJoinInviteLaunchConsent(input: {
  memberId: string | null;
  status: HostedInviteStatusPayload;
}): Promise<JoinInviteLaunchConsentState> {
  if (!shouldGateJoinInviteStatusWithLaunchConsent(input.status)) {
    return {
      gateActive: false,
      initialStatus: null,
      status: "not_required",
    };
  }

  if (!input.memberId) {
    return {
      errorMessage: "We couldn’t load the consent form. Refresh and try again.",
      gateActive: true,
      initialStatus: null,
      status: "error",
    };
  }

  try {
    const consentStatus = sanitizeHostedConsentStatusForClient(
      await readHostedConsentStatus({
        memberId: input.memberId,
        prisma: getPrisma(),
      }),
    );

    if (consentStatus.launchGranted) {
      return {
        gateActive: false,
        initialStatus: consentStatus,
        status: "granted",
      };
    }

    return {
      gateActive: true,
      initialStatus: consentStatus,
      status: "required",
    };
  } catch {
    return {
      errorMessage: "Could not load Murph legal consent right now.",
      gateActive: true,
      initialStatus: null,
      status: "error",
    };
  }
}

function sanitizeHostedConsentStatusForClient(
  status: HostedConsentStatus,
): HostedConsentStatus {
  return {
    ...status,
    scopes: status.scopes.map((scope) => ({
      ...scope,
      grant: null,
    })),
  };
}

function readSingleSearchParam(
  value: string | readonly string[] | null | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  return value?.[0];
}
