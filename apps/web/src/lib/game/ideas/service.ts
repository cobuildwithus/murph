import { hostedAuthRateLimitStorage } from "../../better-auth/rate-limit";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import { areGameIdeasEnabled } from "../access";
import type { GameIdeasInput } from "./input";
import { writeGameIdeas } from "./writer";

export async function suggestGameIdeas(memberId: string, input: GameIdeasInput) {
  if (!areGameIdeasEnabled()) return [];
  const limit = await hostedAuthRateLimitStorage(getPrisma()).consume(`game-ideas:member:${memberId}`, { max: 30, window: 600 });
  if (!limit.allowed) throw hostedOnboardingError({
    code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a few minutes and try again.", retryable: true,
  });
  return writeGameIdeas(input);
}
