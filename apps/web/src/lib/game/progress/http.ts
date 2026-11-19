import { describeLoggedErrorType } from '../../http';
import { hostedOnboardingError, isHostedOnboardingError } from '../../hosted-onboarding/errors';
import { withJsonError } from '../../hosted-onboarding/http';

/** The same private cache policy covers success, input errors and missing pictures. */
export function withProgressJsonError<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  const route = withJsonError(handler);
  return async (...args: Args): Promise<Response> => {
    const response = await route(...args);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
}

/** Private dependency errors never include provider text, health values or media keys. */
export async function progressEffect<T>(operationName: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: 'PROGRESS_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'Progress could not load. Try again.',
      details: { operationName, type: describeLoggedErrorType(error) } });
  }
}
