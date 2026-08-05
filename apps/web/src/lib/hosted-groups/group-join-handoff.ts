import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

export const GROUP_JOIN_POST_AUTH_QUERY_KEY = "postJoin";

const GROUP_JOIN_POST_AUTH_HANDOFFS = ["setup"] as const;

export type GroupJoinPostAuthHandoff = (typeof GROUP_JOIN_POST_AUTH_HANDOFFS)[number];
export type GroupJoinPostJoinDestination =
  | typeof HOSTED_APP_HOME_PATH
  | "/join";
type GroupJoinAuthCompletionHandoff = Pick<
  HostedPrivyCompletionPayload,
  "stage"
>;

export function buildGroupJoinPostAuthReturnPath(input: {
  currentPath: string;
  payload: GroupJoinAuthCompletionHandoff;
}): string {
  const url = new URL(input.currentPath, "https://murph.invalid");
  const handoff = resolveGroupJoinPostAuthHandoff(input.payload);

  if (handoff) {
    url.searchParams.set(GROUP_JOIN_POST_AUTH_QUERY_KEY, handoff);
  } else {
    url.searchParams.delete(GROUP_JOIN_POST_AUTH_QUERY_KEY);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function readGroupJoinPostAuthHandoff(
  value: string | string[] | undefined,
): GroupJoinPostAuthHandoff | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return GROUP_JOIN_POST_AUTH_HANDOFFS.find((handoff) => handoff === candidate) ?? null;
}

export function resolveGroupJoinPostJoinDestination(
  handoff: GroupJoinPostAuthHandoff | null,
): GroupJoinPostJoinDestination {
  switch (handoff) {
    case "setup":
      return "/join";
    default:
      return HOSTED_APP_HOME_PATH;
  }
}

function resolveGroupJoinPostAuthHandoff(
  payload: GroupJoinAuthCompletionHandoff,
): GroupJoinPostAuthHandoff | null {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return "setup";
  }

  return null;
}
