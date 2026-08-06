# Extend hosted provider egress conformance to Telegram

Status: active
Created: 2026-08-06
Updated: 2026-08-06

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

## Verification

- Cloudflare typecheck.
- Focused Linq policy, interceptor, and provider-conformance tests.
- Focused Telegram channel, operator-config runtime, and hosted provider-effect
  tests covering the same clients used by the conformance suite.
- Documentation drift/gardening and `git diff --check`.
- Exact-head required GitHub Actions and final review before closing this plan.
