# Extend hosted provider egress conformance to Telegram

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Preserve the exact Linq capability fix at the Worker trust boundary.
- Prove every Telegram route currently emitted by hosted Murph clients can cross
  the production Cloudflare interceptor with the expected Worker-owned token and
  write-fence checks.
- Keep Telegram polling, webhook administration, and web-control methods outside
  hosted runner egress.

## Scope

- In scope:
  - The existing exact Linq `POST /capability/check_imessage` allowlist entry.
  - A real Linq response-card client-through-interceptor regression.
  - Hosted Linq provider-entry timing and identity: the read-only capability
    lookup must not claim message dispatch, and a definitive card rejection
    must settle the original identity before the persisted text fallback claims
    its replacement identity.
  - Prepared-dispatch reset after a pre-provider yield must preserve the current
    durable outbox identity, including a promoted card fallback identity.
  - A rich-link primary accepted before a later request yields must retain the
    existing partial-delivery checkpoint and deterministic recovery path.
  - A capability HTTP 429 must skip capability retry delay and enter the
    deterministic text fallback immediately.
  - A stalled optional capability read, including a success or error body that
    stalls after response headers, must stop at its 2.5-second deadline and
    enter the deterministic text fallback without consuming the generic Linq
    mutation timeout.
  - A provider-classified app-card `chat_not_found` must settle the card,
    promote the fallback identity, and retain existing stale-direct recovery.
  - Real hosted Telegram client calls for `sendMessage`, `sendPhoto`,
    `sendVoice`, `sendChatAction`, `deleteMessages`,
    `deleteBusinessMessages`, `setMessageReaction`, `getFile`, and the
    provider-returned file-download path.
  - Negative hosted-runner proof for Telegram methods owned by Inboxd polling or
    web control rather than the runner.
- Out of scope:
  - Changing Telegram client behavior, retries, delivery ownership, or payloads.
  - A shared provider registry, generated firewall, schema, queue, cache,
    feature flag, or new effect owner.
  - Inboxd polling transport and web-owned Telegram API calls, which do not
    traverse the hosted runner interceptor.

## Decisions

- Keep the Cloudflare Worker as the sole egress authority. The conformance test
  invokes production clients through the production interceptor; client code
  does not grant itself routes.
- Do not add HTTP-method restrictions to Telegram Bot API method names. Telegram
  officially accepts both GET and POST for Bot API methods; the regression still
  asserts the exact methods Murph's current clients emit.
- Reuse the existing interceptor route-matrix coverage for direct allowlist
  testing and add one cross-boundary suite rather than introducing a provider
  framework.
- Keep the generic provider fetch boundary free of Linq URL classification,
  synthetic HTTP responses, saved provider-entry errors, and per-identity
  promise state. Pass explicit capability and fallback fetch implementations
  through the existing Linq dependency surface instead.
- Treat the current durable outbox intent as the sole delivery-identity owner.
  Prepared reset restores dispatch metadata while preserving that current
  identity, so a settled card identity cannot overwrite its promoted fallback.
- Preserve pre-provider authority and yield errors as typed failures with
  `deliveryMayHaveSucceeded: false`; do not translate them into provider
  responses or let the card runtime convert them into text fallback.
- Disable only rate-limit retries for the optional capability lookup. Message
  mutation retry behavior remains unchanged.
- Give that optional capability lookup one complete 2.5-second attempt across
  fetch and response classification. Its timeout is not the generic 30-second
  Linq mutation timeout, and timeout enters the same deterministic text
  fallback without a retry.
- Treat only an exact classified app-card HTTP 404 `chat_not_found` as a
  definitive no-effect rejection; generic 404, timeout, rate-limit, transport,
  and server failures remain outside the fallback path.

## Review retrospective

- The first correction grew a generic provider boundary from 116 changed lines
  to 266 by combining URL recognition, synthetic responses, saved errors, and
  per-identity dispatch state. That shape duplicated identity ownership already
  held by the durable outbox and obscured the rich-link partial-delivery path.
- The correction was redesigned by deletion: the generic boundary returned to
  one entry promise, capability and text fallback now have explicit fetch
  dependencies, and prepared reset no longer carries an identity snapshot.
- Exact regressions now cover capability-entry yield without fallback
  persistence, rejected-card settlement followed by fallback persistence and
  pre-fallback reset, and primary-rich-link acceptance followed by pre-link
  yield and checkpoint recording.
- Round three found two original-PR UX gaps. Both were accepted: capability 429
  retry delay could postpone the ready text fallback, and a classified stale
  app-card chat could bypass direct-thread recovery. The correction disables
  capability rate-limit retries and switches the existing local provider
  context to the promoted fallback boundary before stale-chat materialization.
  No retry or recovery owner was added.
- Round four found that a stalled capability response could still inherit the
  generic 30-second Linq timeout and withhold already-rendered text for the
  entire foreground reply boundary. The correction threads one private timeout
  override through the existing request path and applies it only to the
  optional capability read.
- Round five found that the round-four timer ended when response headers
  arrived, leaving successful and error body consumption outside the deadline.
  That review-induced gap is corrected by keeping the same single per-attempt
  timeout alive through complete response classification; no second timer or
  lifecycle was added.

## Verification

- Cloudflare typecheck.
- Focused Linq policy, interceptor, and provider-conformance tests.
- Focused Telegram channel, operator-config runtime, and hosted provider-effect
  tests covering the same clients used by the conformance suite.
- Hosted-runtime regressions for authority revocation during capability lookup,
  capability-unavailable fallback ordering, definitive card rejection
  settlement and replacement-identity claim, pre-provider abort reset,
  promoted-identity reset, rich-link partial delivery, immediate capability-429
  fallback, capability-deadline text fallback before headers and during stalled
  success or error bodies, and classified stale-card recovery under the
  fallback identity.
- Documentation drift/gardening and `git diff --check`.
- Exact-head required GitHub Actions passed after one unrelated app-verification
  timeout rerun; the isolated Cloudflare target passed locally before rerun.
- ReviewGPT final round six returned a valid `PASS` on the same exact head after
  verifying every accepted finding and the completed deletion-first
  retrospective.
Completed: 2026-08-07
