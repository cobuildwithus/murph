# murph.ask_grok: ask Grok about X (Twitter), with pass-through per-call billing

## Outcome

Murph can ask Grok anything about X (Twitter) — what an account is posting, what
people are saying about a topic, or what a shared post says — through a new
`murph.ask_grok` dynamic tool that relays Grok's answer. On the normal path, every completed provider call
books the provider's exact reported USD cost against the member's existing hosted AI
usage allowance. Recording is best-effort and post-hoc: a Murph-side accounting
outage can leave a completed call unbilled, while failed provider calls are never
billed. The trusted limit of three provider calls per assistant turn bounds exposure.
No new billing primitives: the tool bills exactly like transcription and ElevenLabs
do today.

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

1. **One tool, `murph.ask_grok`**, one required field: `question` (a free-text
   string, 1–500 chars, carrying any post URL or @handle the user mentioned).
   No actions, no date window, no result count, no pagination. Grok's own
   x_search handles interpretation, including resolving a pasted post URL.
2. **One question in, Grok's answer out — no response parsing.** The tool is
   `murph.ask_grok` with a single `question` string (1–500 chars). The executor
   sends one fixed-shape request: pinned model, `tools: [{type: "x_search"}]`
   with no filters, bounded `max_output_tokens`, `store: false`, and a fixed
   developer instruction to use x_search, include the URL of every post relied
   on, and never invent posts. The response handling is deliberately minimal:
   concatenate the assistant `output_text`, strip control/bidi characters,
   bound the length, and relay it behind an explicit provenance line. No JSON
   contract, no citation join, no URL validation, no handle logic, no dedupe.

   **Why the earlier evidence-binding design was deleted (2026-07-25).** It
   demanded strict JSON and admitted a post only if its status id appeared in a
   same-response `url_citation`. Live testing showed xAI annotates only the
   posts it quotes inline, so a legitimate answer citing 1 of 3 listed posts was
   rejected outright: the member got "unusable response" while the call was
   still billed. Rather than keep tuning a fragile join, the trust model moved
   from parsing to framing — the answer is labeled untrusted, unverified,
   third-party prose, and the tool description requires Murph to attribute what
   it reports to a live X search instead of asserting it as fact. Accepted
   trade-off, on record: fabricated claims are no longer mechanically filtered.

3. **Billing follows the existing egress pattern exactly** (`runner-egress-intercept.ts`,
   like ElevenLabs/transcription): the interceptor injects the credential, buffers the
   completed response, builds a usage record via a new `buildHostedXaiSearchUsageRecord`
   in `packages/hosted-execution/src/assistant-usage.ts`
   (`provider: "xai"`, `featureKey: "x-search"`, `apiKeyEnv: "XAI_API_KEY"`), and posts it
   through `recordHostedRuntimeUsageRecord` off the foreground reply path. When a
   `waitUntil` owner exists the promise is registered there; production container
   interception otherwise leaves the already-started, failure-isolated recorder
   best-effort rather than awaiting it. `rawUsageJson` carries `cost_in_usd_ticks` plus
   token counts. On the normal path the exact provider-reported cost is booked. A
   Murph-side accounting outage can leave a completed call unbilled. No usage row for
   non-completed responses (429/5xx/transport failure) — never bill a failed upstream call.
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
5. **Abuse bound = per-turn ceiling in trusted executor state + normal-path real billing.**
   Max 3 `murph.ask_grok` provider calls per assistant turn, counted in turn-scoped
   executor state (not prompt text). Exceeding returns an explicit
   `x_search_call_limit` failure. Over-allowance members are blocked at the next turn
   admission by the existing gate; worst-case in-turn overshoot (3 × ~$0.01–0.05) is far
   below one existing music-generation call. An accounting outage can therefore leave
   only the already-bounded calls from a turn unbilled; it cannot create unbounded
   provider spend. Deliberately deferred, on record: per-day DB-backed caps,
   thread-scoped result caching, single-flight dedupe, mid-turn allowance checks.
6. **Tool availability** follows the existing capability pattern: available only when the
   xAI key/config is present (mirror how other provider-gated tools are declared in
   `assistant-capabilities.ts` / env policy). When unavailable or over-ceiling or the
   provider fails, the tool returns `success: false` with a specific error code and
   message; the tool description must instruct the model to relay failures plainly and
   never claim a search happened. No silent failure.
7. **Result hygiene:** the relayed answer is length-bounded so one call cannot
   flood resident thread context, control and bidi characters are stripped
   (newlines preserved), and the text is framed as untrusted quoted content
   rather than instructions. Persist nothing beyond the normal thread
   transcript; no question text or answer text in usage rows or structured logs.

8. **Config/secrets:** `XAI_API_KEY` plus optional `XAI_X_SEARCH_MODEL` via
   `packages/operator-config/src/xai-runtime.ts`. The Responses URL is pinned to
   `https://api.x.ai/v1/responses`; there is no production base-URL override to forward,
   allowlist, or deploy. Keep `api.x.ai` in the static provider egress host set and
   restrict the interceptor branch to `POST /v1/responses`.

## Touch set (expected)

- `packages/assistant-engine/src/assistant-codex/{ask-grok-tool.ts,dynamic-tools/ask-grok.ts}` (new) + registration in `dynamic-tools.ts`; availability/capability wiring; per-turn counter in turn state. The billing record keeps `featureKey: "x-search"` and `triggerKind: "x-search"` deliberately: the usage/pricing layer describes the underlying xAI X search and is independent of the tool's name, so renaming it would churn the verified billing seam for no behavior gain.
- `packages/hosted-execution/src/assistant-usage.ts` (usage-record builder).
- `apps/cloudflare/src/runtime-platform/provider-fetch.ts`, `apps/cloudflare/src/runner-egress-intercept.ts` (egress + usage recording), env policy/worker contracts.
- `apps/web/src/lib/hosted-execution/usage-allowance.ts` (pricing branch).
- `packages/operator-config/src/xai-runtime.ts` (new).
- Focused tests in each touched owner mirroring the ElevenLabs/transcription suites.
- `.env.example`, relevant durable docs.

## Verification

`pnpm test:diff` over touched owners; focused suites for dynamic tools, assistant-usage,
usage-allowance, runner-egress-intercept, env policy. Direct scenario proof: scripted
runtime test exercising a mocked `/v1/responses` completion with x_search response-item
and URL-citation evidence, plus focused proof that slow or failed accounting stays off
the foreground delivery path, the usage record wire shape reaches pricing, and blocked
or unusable-response paths fail explicitly.

## Deployment

Web (pricing branch + record acceptance) deploys before Cloudflare (egress + tool).
Requires `XAI_API_KEY` in the hosted runner/Worker environment before the tool
becomes available; absent key keeps the tool unregistered (safe skew).
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
