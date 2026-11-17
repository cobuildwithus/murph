/** Fetch a fresh GitHub Actions ID token per call: a journey can outlive many tokens. */
export function createGitHubActionsOidcTokenSupplier(
  source: Readonly<Record<string, string | undefined>>,
  audience: string,
) {
  return async (signal: AbortSignal): Promise<string> => {
    try {
      const requestUrl = source.ACTIONS_ID_TOKEN_REQUEST_URL;
      const requestToken = source.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      if (!requestUrl || !requestToken) throw new Error();
      const url = new URL(requestUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
      url.searchParams.set("audience", audience);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${requestToken}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("value" in body)
        || typeof body.value !== "string" || !body.value.trim() || body.value.length > 16_384) throw new Error();
      return body.value;
    } catch {
      // Never expose GitHub's response, request URL, or either credential.
      const error = new Error("The Linq production canary failed.");
      error.name = "oidc-token-unavailable";
      throw error;
    }
  };
}
