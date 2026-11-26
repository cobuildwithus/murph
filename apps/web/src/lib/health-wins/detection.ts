import "server-only";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { detectHealthWins } from "./engine";
import { readHealthWinInputs } from "./inputs";

interface DetectionRequest {
  memberId: string;
  today: string;
  checkAuthority: () => Promise<void>;
  signal: AbortSignal;
}

/** Drain bounded source work before a caller presents a fallback or opens a transaction. */
export async function readHealthWinDetection({ memberId, today, checkAuthority, signal: requestSignal }: DetectionRequest) {
  const deadline = AbortSignal.timeout(8_000);
  const signal = AbortSignal.any([requestSignal, deadline]);
  signal.throwIfAborted();
  try {
    const source = await readHealthWinInputs(memberId, checkAuthority, today, signal);
    requestSignal.throwIfAborted();
    if (deadline.aborted) return null;
    return { complete: source.complete, sourceRevision: source.sourceRevision, distanceArtUrl: source.distanceArtUrl,
      detect: () => detectHealthWins(source.input) };
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) throw error;
    requestSignal.throwIfAborted();
    if (deadline.aborted) return null;
    throw error;
  }
}
