import {
  assistantBasePersonaOptions,
  assistantVoiceOptions,
} from "@murphai/contracts";

import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
import {
  readHostedMurphContactContextForMember,
} from "@/src/lib/hosted-onboarding/hosted-contact-context";
import {
  completeHostedInitialOnboardingTx,
  COMPANION_INITIAL_ONBOARDING_SCHEMA,
  parseHostedInitialOnboardingCompletionRequest,
  readHostedInitialOnboardingState,
  type HostedInitialOnboardingCompletionResult,
  type HostedInitialOnboardingState,
} from "@/src/lib/hosted-onboarding/initial-onboarding";
import {
  requireHostedCompanionMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from
  "@/src/lib/hosted-onboarding/shared";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  MURPH_CONTACT_AVATAR_OPTIONS,
} from "@/src/lib/murph-contact-avatars";
import {
  resolveMurphContactOptions,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";
import { getPrisma } from "@/src/lib/prisma";

const INITIAL_ONBOARDING_BODY_LIMIT_BYTES = 1_024;
const INITIAL_MESSAGE = {
  body: "Hey Murph, do your thing",
  subject: "Hey Murph, do your thing",
};

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  const state = await readHostedInitialOnboardingState({
    memberId: auth.member.id,
    prisma,
  });
  if (state.status === "completed") {
    return jsonOk(projectCompletedState(state));
  }

  let contactAction: MurphContactOption | null = null;
  try {
    const contactContext = await readHostedMurphContactContextForMember({
      memberId: auth.member.id,
      prisma,
    });
    contactAction = resolveMurphContactOptions({
      contactChannels: contactContext.initialContactChannels,
      message: INITIAL_MESSAGE,
      murphEmailAddress: contactContext.murphEmailAddress,
      murphPhoneNumber: contactContext.murphPhoneNumber,
      userEmailAddress: contactContext.userEmailAddress,
    })[0] ?? null;
  } catch {
    // Contact-card setup is optional. Never let unavailable encrypted contact
    // context block the canonical onboarding choices or Health continuation.
    console.warn("Companion initial onboarding contact projection unavailable.");
  }

  return jsonOk(projectPendingState({
    contactAction,
    origin: resolveHostedPublicBaseUrl() ?? new URL(request.url).origin,
    state,
  }));
});

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  const completion = parseHostedInitialOnboardingCompletionRequest(
    await readJsonObject(request, {
      limitBytes: INITIAL_ONBOARDING_BODY_LIMIT_BYTES,
    }),
  );
  const result = await prisma.$transaction(
    (tx) => completeHostedInitialOnboardingTx({
      memberId: auth.member.id,
      now: new Date(),
      prisma: tx,
      request: completion,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  if (result.dispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: result.dispatch.mailboxItemId,
    });
  }

  return jsonOk(projectCompletedState(result));
});

function projectCompletedState(
  state: HostedInitialOnboardingState | HostedInitialOnboardingCompletionResult,
) {
  return {
    schema: COMPANION_INITIAL_ONBOARDING_SCHEMA,
    status: "completed" as const,
    ...(state.status === "completed" && "completedNow" in state
      ? { completedNow: state.completedNow }
      : {}),
    preferences: state.preferences,
    catalog: null,
    contactCard: null,
    contactAction: null,
  };
}

function projectPendingState(input: {
  contactAction: MurphContactOption | null;
  origin: string;
  state: HostedInitialOnboardingState;
}) {
  const supportsContactCard = input.contactAction?.kind === "text";
  return {
    schema: COMPANION_INITIAL_ONBOARDING_SCHEMA,
    status: "pending" as const,
    preferences: input.state.preferences,
    catalog: {
      personas: assistantBasePersonaOptions.map((option) => ({
        defaultTone: option.defaultTone,
        defaultVoiceId: option.defaultVoiceId,
        description: option.description,
        id: option.id,
        label: option.label,
        recommendedVoiceIds: option.recommendedVoiceIds,
        supportDescription: option.supportDescription,
      })),
      tones: [
        {
          id: "formal",
          label: "Formal",
          sample: "Your sleep is down this week. Want to work on sleep first?",
        },
        {
          id: "casual",
          label: "Casual",
          sample: "sleep is way down this week. wanna fix sleep first?",
        },
      ],
      voices: assistantVoiceOptions.map((option) => ({
        description: option.description,
        id: option.id,
        label: option.label,
        previewURL: new URL(option.previewPath, input.origin).toString(),
      })),
    },
    contactCard: supportsContactCard
      ? {
          avatars: MURPH_CONTACT_AVATAR_OPTIONS.map((option) => ({
            id: option.id,
            kind: option.kind,
            label: option.label,
            imageURL: option.src
              ? new URL(option.src, input.origin).toString()
              : null,
          })),
          defaultAvatarId: DEFAULT_MURPH_CONTACT_AVATAR_ID,
        }
      : null,
    contactAction: input.contactAction
      ? {
          href: input.contactAction.href,
          kind: input.contactAction.kind,
          label: input.contactAction.label,
        }
      : null,
  };
}

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  const deadlineMs = createHostedPostCommitDeadline(undefined);
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs,
      operation: (abortSignal) => signalHostedMailboxAppendRuntime({
        ...input,
        abortSignal,
      }),
    });
  } catch {
    // Completion is durable even when the best-effort runtime wake is unavailable.
  }
}
