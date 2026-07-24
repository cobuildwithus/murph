# murph.x_search: X (Twitter) search tool with pass-through per-call billing

## Outcome

Murph can search X for posts by query and fetch a profile's recent posts, through a
new `murph.x_search` dynamic tool. Every upstream provider request books the
provider's exact reported USD cost against the member's existing hosted AI usage
allowance, so a member cannot make Murph burn provider spend beyond their metered
allowance. No new billing primitives: the tool bills exactly like transcription and
ElevenLabs do today.

## Provider

xAI Responses API (`POST /v1/responses` on `https://api.x.ai`) with the server-side
`x_search` tool. Verified against docs.x.ai on 2026-07-23:

- Tools entry: `{"type": "x_search", "allowed_x_handles": [...], "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD"}`.
  `allowed_x_handles` max 20, mutually exclusive with `excluded_x_handles`; handles without `@`.
- Model: `grok-4.5` (the documented x_search-capable model). Token pricing $2/M in, $6/M out
  (<200k prompt tokens); x_search invocations $5 per 1,000 calls.
- Billing: every response's `usage.cost_in_usd_ticks` is the exact billed amount for the
  whole request (tokens + server-side tool invocations, post-discount). 1 USD = 10^10 ticks.
  This is why xAI was chosen over the official X API (app-wide daily read dedupe makes
  per-request cost non-attributable) and per-call gateways (no per-response debit field).

## Design decisions (settled; do not re-litigate in implementation)

1. **One tool, `murph.x_search`**, discriminated `action`: `search_posts`
   (`query` 1–256 chars, required) and `profile_posts` (`username` matching
   `^@?[A-Za-z0-9_]{1,15}$`, required). Shared optional fields: `lookbackDays`
   (int 1–30, default 7), `maxResults` (int 1–8, default 5). No pagination/cursors.
2. **Provider request is fixed-shape, not model-forwarded.** The executor builds a fixed
   developer prompt from validated input asking for strict JSON
   (`{"posts":[{"url","authorHandle","createdAt","excerpt"}]}`), pinned model, only the
   `x_search` tool (with `allowed_x_handles=[username]` for `profile_posts`,
   `from_date`/`to_date` from `lookbackDays`), bounded `max_output_tokens`, `store: false`.
   Parse fail-closed: invalid JSON or a post without a valid
   `https://x.com/<handle>/status/<id>` URL is dropped; zero valid posts with a completed
   response returns an explicit no-results failure (the cost is still booked — it was incurred).
3. **Billing follows the existing egress pattern exactly** (`runner-egress-intercept.ts`,
   like ElevenLabs/transcription): the interceptor injects the credential, buffers the
   completed response, builds a usage record via a new `buildHostedXaiSearchUsageRecord`
   in `packages/hosted-execution/src/assistant-usage.ts`
   (`provider: "xai"`, `featureKey: "x-search"`, `apiKeyEnv: "XAI_API_KEY"`), and posts it
   through `recordHostedRuntimeUsageRecord`. `rawUsageJson` carries
   `cost_in_usd_ticks` plus token counts. No usage row for non-completed responses
   (429/5xx/transport failure) — never bill a failed upstream call.
4. **Pricing branch reads the provider-reported cost.** In
   `apps/web/src/lib/hosted-execution/usage-allowance.ts`, add an `x-search` branch
   *before* generic token pricing that converts `cost_in_usd_ticks` to USD micros
   (ceil-divide by 10^4). Precedent: the Retell branch already prices from a
   record-carried cost. A record missing a valid `cost_in_usd_ticks` deliberately
   fails closed: it falls through to token-model pricing, which throws on the
   unpriced model and rolls the row back with a Worker warn log, instead of ever
   accounting the call as free or estimating from tokens. No reservation tables, no
   reserve/settle endpoints, no remainder ledgers — post-hoc accrual into
   `HostedAiUsagePeriod` with existing `blockedAt` semantics, same as every other feature.
5. **Abuse bound = per-turn ceiling in trusted executor state + real billing.**
   Max 3 `murph.x_search` provider calls per assistant turn, counted in turn-scoped
   executor state (not prompt text). Exceeding returns an explicit
   `x_search_call_limit` failure. Over-allowance members are blocked at the next turn
   admission by the existing gate; worst-case in-turn overshoot (3 × ~$0.01–0.05) is far
   below one existing music-generation call. Deliberately deferred, on record: per-day
   DB-backed caps, thread-scoped result caching, single-flight dedupe, mid-turn
   allowance checks.
6. **Tool availability** follows the existing capability pattern: available only when the
   xAI key/config is present (mirror how other provider-gated tools are declared in
   `assistant-capabilities.ts` / env policy). When unavailable or over-ceiling or the
   provider fails, the tool returns `success: false` with a specific error code and
   message; the tool description must instruct the model to relay failures plainly and
   never claim a search happened. No silent failure.
7. **Result hygiene:** at most 8 posts, excerpts ≤ 600 chars, serialized result ≤ 12 KiB
   (shorten excerpts first, then drop tail posts and mark `partial: true`). Strip control
   characters and bidi overrides; excerpts are framed in the result as untrusted quoted
   content, not instructions. Persist nothing beyond the normal thread transcript; no
   query text or post text in usage rows or structured logs.
8. **Config/secrets:** `XAI_API_KEY` (+ optional `XAI_API_BASE_URL`, default
   `https://api.x.ai`) via a new `packages/operator-config/src/xai-runtime.ts` resolver
   mirroring `elevenlabs-runtime.ts`. Add the hostname to the provider egress allowlist
   in `apps/cloudflare/src/runtime-platform/provider-fetch.ts` and restrict the
   interceptor branch to `POST /v1/responses`. Update `.env.example` and hosted env
   policy/worker contracts like existing provider keys.

## Touch set (expected)

- `packages/assistant-engine/src/assistant-codex/dynamic-tools/x-search.ts` (new) + registration in `dynamic-tools.ts`; availability/capability wiring; per-turn counter in turn state.
- `packages/hosted-execution/src/assistant-usage.ts` (usage-record builder).
- `apps/cloudflare/src/runtime-platform/provider-fetch.ts`, `apps/cloudflare/src/runner-egress-intercept.ts` (egress + usage recording), env policy/worker contracts.
- `apps/web/src/lib/hosted-execution/usage-allowance.ts` (pricing branch).
- `packages/operator-config/src/xai-runtime.ts` (new).
- Focused tests in each touched owner mirroring the ElevenLabs/transcription suites.
- `.env.example`, relevant durable docs.

## Verification

`pnpm test:diff` over touched owners; focused suites for dynamic tools, assistant-usage,
usage-allowance, runner-egress-intercept, env policy. Direct scenario proof: scripted
runtime test exercising a mocked `/v1/responses` completion end-to-end (tool call →
usage record shape → pricing branch), plus explicit blocked/failure-path tests.

## Deployment

Web (pricing branch + record acceptance) deploys before Cloudflare (egress + tool).
Requires `XAI_API_KEY` in the hosted runner/Worker environment before the tool
becomes available; absent key keeps the tool unregistered (safe skew).
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
