import "server-only";
import { createHostedOpaqueDigest, readHostedContactPrivacyCurrentVersion } from "../hosted-onboarding/contact-privacy";
import { describeKnownLoggedErrorType } from "../http";
import type { HealthWinAchievement } from "./engine";
import { dayNumber } from "./engine/shared";

// Changes to the identity tuple require explicit migration of suppression history.
const ACHIEVEMENT_IDENTITY_VERSION = "v1";

export interface HealthWinObservations {
  version: string;
  items: { seenKey: string; winRef: string; fresh: boolean }[];
}

function isFresh(achievement: HealthWinAchievement, today: string): boolean {
  switch (achievement.kind) {
    case "experiment_result":
      return true;
    case "personal_record":
    case "lab_change":
    case "lab_percentile": {
      const age = dayNumber(today) - dayNumber(achievement.period);
      return age >= 0 && age < (achievement.kind === "personal_record" ? 3 : 90);
    }
    default:
      return achievement.period === today.slice(0, 7);
  }
}

/** The same ranked descriptor order drives seen-history consumption and link selection. */
export function readHealthWinIdentities(
  memberId: string, achievements: readonly HealthWinAchievement[], today: string,
): HealthWinObservations | null {
  try {
    const keyVersion = readHostedContactPrivacyCurrentVersion();
    const items = achievements.map(achievement => {
      const key = JSON.stringify([memberId, achievement.kind, achievement.subject, achievement.period]);
      return {
        seenKey: createHostedOpaqueDigest("health-win-seen", key),
        winRef: createHostedOpaqueDigest("health-win-link", key),
        fresh: isFresh(achievement, today),
      };
    });
    return { version: `${keyVersion}:${ACHIEVEMENT_IDENTITY_VERSION}`, items };
  } catch (error) {
    console.warn("Health win achievement keys unavailable.", { errorClass: describeKnownLoggedErrorType(error) });
    return null;
  }
}
