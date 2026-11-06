const HOSTED_LOCAL_WORKER_RESTART_BODY = "Your worker restarted mid-request.";
const HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES = 4;

/** Call only for replay-safe local Worker controls, with one reusable request body. */
export async function fetchHostedLocalWorkerWithRestartRetry(
  url: URL,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, init);
    if (
      response.status !== 503
      || attempt >= HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES
      || !(await response.clone().text()).includes(HOSTED_LOCAL_WORKER_RESTART_BODY)
    ) {
      // Leave the actual response available to the caller's error diagnostics.
      return response;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250 * (attempt + 1));
    });
  }
}
