import { Agent } from "undici";

import { CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES } from "./internal-hosts.ts";

// One process-owned pool preserves intercepted hostnames and avoids repeating DNS
// and connection setup between runtime passes. Honor shorter server idle limits.
const internalDispatcher = new Agent({
  keepAliveTimeout: 300_000,
  keepAliveMaxTimeout: 300_000,
});

export const fetchHostedRunnerInternal: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return fetch(input, init);
  }
  const internalInit: RequestInit & { dispatcher: Agent } = {
    ...init,
    dispatcher: internalDispatcher,
  };
  return fetch(input, internalInit);
};
