Goal (incl. success criteria):
- Make hosted Telegram PDF/document attachment hydration tolerate transient Telegram/effect egress failures.
- Success means transient retryable `getFile` or file download failures are retried before the assistant sees only metadata, while terminal failures still degrade to metadata-only without blocking mailbox import.

Constraints/Assumptions:
- Web remains the owner of Telegram ingress, mailbox append, and Temporal wake handoff.
- Cloudflare remains the owner of Worker-mediated Telegram credential injection/effects.
- Assistant runtime may retry read-only Telegram file lookup/download calls, but must not change webhook acknowledgement semantics, mailbox watermarks, or provider-visible sends.
- Retries must be bounded and abort-aware.
- Preserve unrelated active ledger rows and unrelated working-tree edits.

Key decisions:
- Add the retry at the assistant-runtime Telegram attachment download-driver boundary so both direct hosted-local fetch and Cloudflare effects-port paths are covered.
- Retry only transient transport/status failures; do not retry terminal Telegram/API/auth/not-found/oversize failures.
- Keep final failure behavior unchanged: the inbox normalizer still returns a metadata-only attachment after retry exhaustion.
- Thread the existing runner abort signal into conversation mailbox import instead of adding a new cancellation mechanism.
- Abort is not a terminal Telegram attachment failure: cancellation must stop import work instead of producing a durable metadata-only capture.
- The Telegram download limit must be enforced before or during byte reads, not only after buffering a completed response.

State:
- Implementation, audit follow-up, and scripted verification complete.

Done:
- Production logs and local repro identified transient `getFile` failure degrading PDF attachment hydration to metadata-only.
- Official Telegram docs checked: `getFile` returns a file path for download, links are at least one hour, files up to 20 MB are downloadable by Bot API, and `file_unique_id` cannot be used for download.
- Added a bounded retry wrapper around the selected Telegram attachment download driver before existing logging.
- Added regression coverage for transient retry success, terminal failure no-retry, abort no-retry, and metadata-only PDF preservation after retry exhaustion.
- Security/privacy and coverage-write audits passed; deep review found one accepted follow-up for oversized Telegram downloads returning retryable 502 from the Cloudflare effect boundary.
- Fixed the Cloudflare provider-effect oversize path to return terminal 413 + `retryable: false` instead of generic 502, with contract coverage.
- Fixed the deep-review abort-signal follow-up by passing the runner signal through the mailbox import context to Telegram normalization, with adapter coverage.
- Ran ReviewGPT on PR 180; accepted and fixed its three cancellation findings:
  - production runtime import wrappers now preserve the foreground import signal;
  - Telegram attachment aborts rethrow through inboxd and mailbox projection instead of recording a failed imported outcome;
  - Telegram provider-effect calls now pass caller signals into the Cloudflare internal fetch.
- Ran a second ReviewGPT pass on PR 180; accepted and fixed its two findings:
  - Telegram direct downloads now enforce a bounded byte reader and content-length gate, and known oversized Telegram files stay metadata-only without calling download;
  - conversation mailbox import now checks cancellation before preparation/staging/projection side effects.
- Verified:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-telegram-event.test.ts hosted-runtime-conversation-event.test.ts hosted-runtime-mailbox-conversation-import.test.ts`
  - `pnpm --dir packages/inboxd test -- telegram-connector.test.ts`
  - `pnpm --dir apps/cloudflare test -- runner-platform.test.ts runner-provider-effects-contract.test.ts`
  - `pnpm build:test-runtime:prepared`
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/events/telegram.ts packages/assistant-runtime/src/hosted-runtime/events/conversation.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/platform.ts packages/assistant-runtime/test/hosted-runtime-telegram-event.test.ts packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts packages/inboxd/src/connectors/telegram/normalize.ts packages/inboxd/test/telegram-connector.test.ts apps/cloudflare/src/runner-outbound/provider-effects.ts apps/cloudflare/src/runtime-platform/effects-port.ts apps/cloudflare/src/runtime-platform/hosted-http.ts apps/cloudflare/test/runner-provider-effects-contract.test.ts apps/cloudflare/test/runner-platform.test.ts`
  - `pnpm test:smoke`

Now:
- Handoff after final diff review and PR update.

Next:
- Handoff with ReviewGPT round 2 result, fix summary, and verification.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/events/telegram.ts
- packages/assistant-runtime/src/hosted-runtime/events/conversation.ts
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/src/hosted-runtime/platform.ts
- packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/test/hosted-runtime-telegram-event.test.ts
- packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts
- packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts
- packages/inboxd/src/connectors/telegram/normalize.ts
- packages/inboxd/test/telegram-connector.test.ts
- apps/cloudflare/src/runtime-platform/effects-port.ts
- apps/cloudflare/src/runtime-platform/hosted-http.ts
- apps/cloudflare/src/runner-outbound/provider-effects.ts
- apps/cloudflare/test/runner-provider-effects-contract.test.ts
- apps/cloudflare/test/runner-platform.test.ts
- pnpm typecheck
- pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/events/telegram.ts packages/assistant-runtime/src/hosted-runtime/events/conversation.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/src/hosted-runtime/platform.ts packages/assistant-runtime/test/hosted-runtime-telegram-event.test.ts packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts packages/inboxd/src/connectors/telegram/normalize.ts packages/inboxd/test/telegram-connector.test.ts apps/cloudflare/src/runner-outbound/provider-effects.ts apps/cloudflare/src/runtime-platform/effects-port.ts apps/cloudflare/src/runtime-platform/hosted-http.ts apps/cloudflare/test/runner-provider-effects-contract.test.ts apps/cloudflare/test/runner-platform.test.ts
- pnpm test:smoke
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
