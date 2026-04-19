export function buildLocalInternalProxyRouteBaseUrl(input: {
  baseUrl: string;
  userId: string;
}): string {
  const normalizedBaseUrl = ensureTrailingSlash(new URL(input.baseUrl));
  const routeBaseUrl = new URL(
    `__murph/local-internal-proxy/users/${encodeURIComponent(input.userId)}/`,
    normalizedBaseUrl,
  );
  return routeBaseUrl.toString();
}

export function isScopedLocalInternalProxyBaseUrl(value: URL): boolean {
  return /^\/__murph\/local-internal-proxy\/users\/[^/]+\/$/u.test(value.pathname);
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.toString().replace(/\/?$/u, "/"));
}
