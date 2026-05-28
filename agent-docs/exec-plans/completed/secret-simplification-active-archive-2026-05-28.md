After stress-testing the “one intercept primitive” idea against the codebase, I still think it is the right north star, with one important refinement:

**Do not replace the current effects tunnel by blindly relying on existing direct fallbacks. Some fallbacks are incomplete today. Replace the tunnel with normal provider clients, but route those provider clients through a tiny hosted fetch/credential mode that Cloudflare intercepts.**

## Final target

```txt
Runtime code calls providers normally.
Cloudflare runtime env contains placeholders, not secrets.
RunnerContainer has one outbound intercept.
The intercept validates, injects/rewrites credentials, strips internal authority headers, and fetches upstream.
```

End-state:

```txt
OpenAI      -> normal Codex/OpenAI request -> intercept injects OPENAI_API_KEY
Mapbox      -> normal Mapbox request       -> intercept injects MAPBOX_ACCESS_TOKEN
Linq        -> normal Linq API request     -> intercept injects LINQ_API_TOKEN
Telegram    -> normal Telegram API request -> intercept rewrites bot token
WhatsApp    -> normal Graph API request    -> intercept injects token + phone id
Internal    -> normal internal virtual host request -> intercept routes to Worker authority
```

That collapses the hacky “send Linq through `/linq/send` tunnel” model into a single egress primitive.

## Stress-test findings

### 1. The current Linq/Telegram/WhatsApp tunnel is real and removable

Murph currently exposes provider-effect routes like `/linq/send`, `/telegram/send`, `/whatsapp/send`, etc. in `runner-effects-contract.ts`.  Cloudflare Worker-side code parses those payloads, checks write-fence authority, and dispatches provider effects. 

That is exactly the complexity you want to collapse.

### 2. Existing direct-provider clients already exist

This is why the migration is feasible.

Linq already has direct HTTP client logic: it resolves `LINQ_API_TOKEN`, defaults to `https://api.linqapp.com/api/partner/v3`, builds Bearer auth, and calls `/phone_numbers`, `/chats`, `/chats/:id/messages`, typing, mark-read, and delete endpoints. 

Telegram already builds Bot API URLs from `TELEGRAM_BOT_TOKEN` and `TELEGRAM_API_BASE_URL`. 

WhatsApp already builds Graph API sends from `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, graph version, and base URL. 

Mapbox already uses direct Mapbox URLs and passes `MAPBOX_ACCESS_TOKEN` as `access_token`.    

OpenAI/Codex already points at OpenAI and uses `OPENAI_API_KEY`. 

### 3. Do not delete `effectsPort` fallback naively

This is the biggest bug risk.

In `callbacks.ts`, delivery currently prefers `effectsPort.sendLinq/sendTelegram/sendWhatsApp` but has fallback direct calls when those methods are missing.  However, the Linq direct fallback is not behavior-equivalent: the code computes `directRecipientPhoneNumber` and `fromPhoneNumber` for the effects-port request, but the direct fallback calls `sendLinqMessage(request, ...)` without those computed values. 

So the migration should not be “remove `effectsPort.sendLinq` and hope fallback works.” Instead, create a direct hosted provider delivery adapter that uses the same semantics as the Worker provider effect path.

The simplest fix: move/ reuse the `hosted-provider-effects.ts` functions in runtime direct mode. That file already has hosted Linq recovery/materialization behavior and dispatches Linq/Telegram/WhatsApp provider calls. 

### 4. Direct provider requests need invocation authority

The old tunnel enforced write-fence authority before provider writes.  If we move provider calls direct, the intercept must enforce the same thing before injecting credentials.

Murph already has write-fence headers and validation:

```txt
x-hosted-runtime-attempt-id
x-hosted-runtime-lease-generation
x-hosted-runtime-workspace-version
```

with validation against the `UserRunner` Durable Object. 

So the new rule should be:

```txt
Any credential-injected write call must carry valid runtime write-fence headers.
The intercept validates them before injecting secrets.
The intercept strips those headers before upstream fetch.
```

That preserves stale-invocation protection without adding a new registry.

### 5. We need one tiny hosted fetch wrapper, not a new framework

Existing direct provider clients call `fetch` or accept `fetchImplementation`. To keep provider code normal, add one minimal hosted wrapper:

```ts
createHostedProviderFetch({ readCurrentLease, userId })
```

It only does two things:

1. Adds runtime authority headers to outgoing provider requests in hosted Cloudflare mode.
2. Leaves local mode alone.

Then Cloudflare outbound intercept does the real security work.

This is not another tunnel. It is only request metadata for the intercept.

### 6. Telegram and WhatsApp are path-rewrite cases

OpenAI, Linq, and WhatsApp use Bearer headers. Mapbox uses a query param. Telegram puts the token in the URL path:

```txt
/bot<TOKEN>/sendMessage
```

So hosted mode needs a sentinel token:

```txt
TELEGRAM_BOT_TOKEN=__cloudflare_injected__
```

The intercept rewrites:

```txt
/bot__cloudflare_injected__/sendMessage
-> /bot<real token>/sendMessage
```

WhatsApp also needs a sentinel phone number id:

```txt
WHATSAPP_PHONE_NUMBER_ID=__cloudflare_injected__
```

The intercept rewrites:

```txt
/v25.0/__cloudflare_injected__/messages
-> /v25.0/<real phone number id>/messages
```

### 7. Email is not the same

Hosted email currently uses Cloudflare Worker-side binding/config and hosted web callback logic, not a simple external HTTP API call. `runner-outbound/results.ts` handles email send through Worker-side logic. 

Do not force email into “normal provider HTTP” unless you intentionally switch to an external email API. Keep it as an internal Worker capability routed through the same intercept.

### 8. Device sync is the hardest and should be later

Device sync has user OAuth tokens, hosted/local sync state, and provider client credentials. The runtime hydrates and reconciles device-sync state, including encrypted access/refresh token bundles.  Its config reader still serializes some Oura/Whoop/Strava client credentials while treating Junction provider secrets differently.  Provider env specs classify these as secrets. 

This can eventually fit the same intercept model, but it is not just “inject env variables.” User OAuth tokens are per-user credentials, not platform env vars. Defer device sync until the delivery/model/map APIs are clean.

### 9. HTTPS interception needs explicit runtime CA trust env

Cloudflare creates the interception CA at runtime, not build time. The container supervisor should set `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` to the Cloudflare Containers CA path so Node, Python requests, and curl-based tooling have an explicit trust pointer. The isolated child launcher must preserve those CA env vars while continuing to block user runner-secret overrides for process trust configuration.

## Final migration guide

### Phase 0 — Define the one primitive

Create one owner module:

```txt
apps/cloudflare/src/runner-egress-intercept.ts
```

It should be the only place that can attach Worker secrets to container-originated HTTP/S.

```ts
export async function hostedRunnerIntercept(
  request: Request,
  env: WorkerEnvironmentSource,
  ctx: OutboundHandlerContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (isInternalMurphHost(url.hostname)) {
    return handleInternalMurphRequest(request, env, ctx);
  }

  if (isOpenAiRequest(url)) return handleOpenAiRequest(request, env);
  if (isMapboxRequest(url)) return handleMapboxRequest(request, env);
  if (isLinqRequest(url)) return handleLinqRequest(request, env);
  if (isTelegramRequest(url)) return handleTelegramRequest(request, env);
  if (isWhatsAppRequest(url)) return handleWhatsAppRequest(request, env);

  return auditThenPassThroughDuringMigration(request, env, ctx);
}
```

In `RunnerContainer`:

```ts
export class RunnerContainer extends Container {
  interceptHttps = true;
}

RunnerContainer.outbound = hostedRunnerIntercept;
```

Keep internet enabled at first. Do not deny unknown egress until logs prove you have full coverage.

### Phase 0.5 — Cut internal callback transport to the intercept

Before provider-secret migration, move Murph internal virtual hosts onto the same Cloudflare Container outbound primitive:

```txt
container runtime fetches http://web-control.worker/...
Container outbound handler catches the virtual host
Worker dispatches to handleRunnerOutboundRequest()
write-fence headers still prove invocation authority
```

Then delete the public-ish callback transport:

```txt
runtimeCallbackBaseUrl in RunnerContainer payloads
HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL
createHostedRuntimeCallbackUrl()
createHostedInternalProxyRequest()
maybeHandleRuntimeCallbackRoute()
/__murph/runtime-callback/users/... route shape
deploy preflight requirement for HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL
```

Keep `handleRunnerOutboundRequest()` as the internal-host dispatcher. This phase should not remove provider-specific effects routes yet; those shrink in the later provider phases.

### Phase 1 — Add hosted placeholder credentials

Add one sentinel:

```ts
export const HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL =
  "__cloudflare_injected__";
```

In Cloudflare hosted runtime env, provide placeholders:

```txt
OPENAI_API_KEY=__cloudflare_injected__
MAPBOX_ACCESS_TOKEN=__cloudflare_injected__
LINQ_API_TOKEN=__cloudflare_injected__
TELEGRAM_BOT_TOKEN=__cloudflare_injected__
WHATSAPP_ACCESS_TOKEN=__cloudflare_injected__
WHATSAPP_PHONE_NUMBER_ID=__cloudflare_injected__
```

Local runtime continues using real local env vars.

Important: the static secret invariant test should assert that the real values never appear in job JSON, child stdin, child env, or runtime env. It already tracks these surfaces and currently has a temporary allowlist. 

### Phase 2 — Add a hosted provider fetch wrapper

Add a minimal helper inside assistant runtime / Cloudflare runtime boundary:

```ts
function createHostedProviderFetch(input: {
  readCurrentLease: () => HostedRuntimeBridgeCheckpointLease | null;
}): typeof fetch {
  return async (requestInfo, init) => {
    const request = requestInfo instanceof Request
      ? requestInfo
      : new Request(requestInfo, init);

    const headers = new Headers(request.headers);
    const lease = input.readCurrentLease();

    if (lease) {
      writeRunnerRuntimeWriteFenceHeaders(headers, lease);
    }

    return fetch(new Request(request, { headers }));
  };
}
```

Use this fetch for provider clients in hosted mode.

The intercept must strip these headers before sending upstream.

### Phase 3 — OpenAI via intercept

Change Codex hosted config so it accepts `OPENAI_API_KEY=__cloudflare_injected__` in Cloudflare mode. Do not require the real key in the container.

Intercept behavior:

```txt
host: api.openai.com
protocol: https
allowed paths: /v1/*
action: overwrite Authorization: Bearer <env.OPENAI_API_KEY>
strip Murph authority headers
fetch upstream
```

### Phase 4 — Mapbox via intercept

Let Mapbox route code run normally with:

```txt
MAPBOX_ACCESS_TOKEN=__cloudflare_injected__
```

Intercept behavior:

```txt
host: api.mapbox.com
allowed path families:
  /directions/...
  /search/geocode/...
  /search/searchbox/...
  /v4/mapbox.mapbox-terrain-v2/tilequery/...
action: overwrite access_token query param
strip Murph authority headers
fetch upstream
```

### Phase 5 — Linq via normal client, not effects tunnel

Replace hosted delivery’s Linq effects-port call with a direct hosted provider adapter that preserves current hosted semantics.

Do **not** call the current direct fallback as-is. Fix the bug by ensuring `directRecipientPhoneNumber` and `fromPhoneNumber` are preserved in direct mode.

Preferred implementation:

```txt
callbacks.ts direct hosted mode
  -> sendHostedProviderLinqMessage(...)
  -> operator-config/linq-runtime direct HTTP client
  -> Cloudflare intercept injects LINQ_API_TOKEN
```

Intercept behavior:

```txt
host: resolved LINQ_API_BASE_URL host, default api.linqapp.com
allowed paths:
  GET    /api/partner/v3/phone_numbers
  POST   /api/partner/v3/chats
  POST   /api/partner/v3/chats/:chatId/messages
  POST   /api/partner/v3/chats/:chatId/typing
  DELETE /api/partner/v3/chats/:chatId/typing
  POST   /api/partner/v3/chats/:chatId/read
  DELETE /api/partner/v3/messages/:messageId
require valid write fence for POST/DELETE
overwrite Authorization: Bearer <env.LINQ_API_TOKEN>
strip Murph authority headers
fetch upstream
```

Then delete the Linq-specific tunnel routes:

```txt
/linq/send
/linq/chat-action
/linq/chats/mark-read
/linq/messages/delete
```

### Phase 6 — Telegram via normal client

Run existing Telegram client normally with:

```txt
TELEGRAM_BOT_TOKEN=__cloudflare_injected__
```

Intercept behavior:

```txt
host: api.telegram.org, or configured TELEGRAM_API_BASE_URL host
allowed paths:
  /bot__cloudflare_injected__/sendMessage
  /bot__cloudflare_injected__/sendChatAction
  /bot__cloudflare_injected__/deleteMessages
  /bot__cloudflare_injected__/deleteBusinessMessages
  /bot__cloudflare_injected__/getFile
require valid write fence for sends/deletes/chat actions
rewrite /bot__cloudflare_injected__/... to /bot<env.TELEGRAM_BOT_TOKEN>/...
strip Murph authority headers
fetch upstream
```

Then delete Telegram send/chat-action tunnel routes. File download is a judgment call: you can migrate it too, but preserve current size limits and safe file handling.

### Phase 7 — WhatsApp via normal client

Run existing WhatsApp client normally with:

```txt
WHATSAPP_ACCESS_TOKEN=__cloudflare_injected__
WHATSAPP_PHONE_NUMBER_ID=__cloudflare_injected__
```

Intercept behavior:

```txt
host: graph.facebook.com, or configured WHATSAPP_API_BASE_URL host
allowed path:
  /v*/__cloudflare_injected__/messages
require valid write fence
rewrite phone number id path segment
overwrite Authorization: Bearer <env.WHATSAPP_ACCESS_TOKEN>
strip Murph authority headers
fetch upstream
```

Then delete `/whatsapp/send` tunnel route.

### Phase 8 — Keep internal Worker capabilities under the same intercept

Do not delete internal virtual hosts. They are still useful for Murph-owned capabilities:

```txt
artifacts.worker
browser-vault.worker
web-control.worker
results.worker
```

But their scope should shrink.

Keep internal Worker capabilities for:

```txt
artifact read/write
browser-vault replica write
workspace checkpoint/read
mailbox fetch
runtime logs
usage records
email via Cloudflare binding
```

Remove provider-send responsibilities once direct provider egress is migrated.

### Phase 9 — Delete generic runner secret env injection

Once OpenAI, Mapbox, Linq, Telegram, and WhatsApp are handled by intercept:

```txt
delete/disable generic runner secret -> userEnv injection
delete HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS for hosted production
delete per-user arbitrary env secret support unless there is a very explicit product need
```

This is where complexity actually disappears.

### Phase 10 — Device sync later

Do not block the main migration on device sync.

First, make the intercept audit all device-sync provider egress. Then decide whether to:

1. move device-sync provider calls to normal direct clients with placeholder credentials, or
2. keep device sync behind Worker/web control because user OAuth tokens are per-user and more sensitive than platform env vars.

Given the current token-bundle behavior, I would keep this separate until the provider-send migration is done.

### Phase 11 — Turn audit into policy

After deploy logs show full classification:

```txt
unknown egress -> deny
```

Then optionally:

```ts
enableInternet = false;
```

But do not start there. Start with intercept + audit + pass-through.

## The clean final architecture

```txt
RunnerContainer
  one Cloudflare outbound intercept

Hosted runtime
  normal provider clients
  placeholder credentials in Cloudflare
  real credentials only in local dev

Cloudflare intercept
  validates host/path/method
  verifies write-fence for side-effectful calls
  injects/rewrites credentials
  strips Murph headers
  logs safe metadata
  denies unknown egress after audit

Deleted complexity
  provider effects tunnel for Linq/Telegram/WhatsApp
  runtimeCallbackBaseUrl for provider sends
  real secrets in job JSON / child env
  arbitrary runner secret env injection
```

My final recommendation: migrate **OpenAI and Mapbox first**, then **Linq**, then **Telegram/WhatsApp**, because Linq has the subtle direct-recipient/from-phone edge case and will validate the architecture before the rest.
