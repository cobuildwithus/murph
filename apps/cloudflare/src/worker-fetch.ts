const cloudflareWorkerFetch: typeof fetch = (request, init) =>
  globalThis.fetch(request, init);

export function normalizeCloudflareWorkerFetch(fetchImpl?: typeof fetch): typeof fetch {
  // Workerd's global fetch is receiver-sensitive; injected test/custom fetches
  // should keep their original call shape.
  return fetchImpl === undefined || fetchImpl === globalThis.fetch
    ? cloudflareWorkerFetch
    : fetchImpl;
}
