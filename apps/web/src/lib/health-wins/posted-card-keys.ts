import "server-only";
import { createHostedOpaqueDigest } from "../hosted-onboarding/contact-privacy";
import { describeKnownLoggedErrorType } from "../http";

export function postedCardKeys(memberId: string, candidateIds: readonly string[]): Map<string, string> {
  const keys = new Map<string, string>();
  try {
    for (const id of candidateIds) {
      if (!id.startsWith("activity:")) {
        keys.set(id, createHostedOpaqueDigest("health-win-card", `${memberId}:${id}`));
      }
    }
    return keys;
  } catch (error) {
    console.warn("Health win card keys unavailable.", { errorClass: describeKnownLoggedErrorType(error) });
    return new Map();
  }
}
