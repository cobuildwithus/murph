import { hostedOnboardingError, isHostedOnboardingError } from '../../hosted-onboarding/errors';

/** Private dependency errors never include provider text, health values or media keys. */
export async function progressEffect<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: 'PROGRESS_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'Progress could not load. Try again.' });
  }
}
