Goal (incl. success criteria):
- Add a standalone pure Linq API repro harness for the iMessage typing-indicator issue, independent of Murph hosted/Cloudflare runtime.
- Success: script exercises typing before and after a direct Linq API outbound message, records status/timing evidence, and avoids printing raw phone numbers, chat ids, message ids, tokens, or message text.

Constraints/Assumptions:
- Preserve privacy: no raw contact identifiers, provider identifiers, message text, secrets, local usernames, or home paths in committed files or default output.
- Do not touch hosted runtime behavior, Cloudflare, web ingress, assistant runtime, or production Linq code paths.
- The repro depends on a real Linq inbound chat id supplied by the operator after the phone has messaged the Linq line.
- The live observation window defaults to 5 minutes, matching the reported typing cutoff, and can be overridden with `LINQ_REPRO_OBSERVATION_MS` / `--observation-ms`.
- Raw live chat id and message text are env-only to keep them out of argv by default.

Key decisions:
- Use a standalone `scripts/` tool instead of changing product runtime instrumentation.
- Require an explicit confirmation flag for the optional outbound message because it sends a real iMessage through Linq.
- Make the default report shareable by using short HMAC fingerprints when `LINQ_REPRO_LOG_FINGERPRINT_SECRET` is set, and presence-only redaction otherwise.

State:
- completed

Done:
- Created this plan.
- Added standalone pure Linq API repro script and focused tests.
- Ran focused Vitest, workspace typecheck, and diff whitespace checks successfully.
- Addressed required review findings: removed freeform notes from reports, added stop-in-finally/SIGINT cleanup, removed raw `--chat-id`/`--message` CLI args, and reran checks successfully.
- Completed required security/privacy, simplify, and final review passes.

Now:
- Ready for live repro once the operator provides the Linq token/chat env and is watching the recipient device.

Next:
- Run live Linq API repro only after credentials/chat id are present and the user is ready to observe the recipient device.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Exact Linq-side expected behavior for `POST /chats/:chatId/typing` before the first outbound provider message in a user-started iMessage chat.

Working set (files/ids/commands):
- `scripts/linq-typing-repro.ts`
- `scripts/linq-typing-repro.test.ts`
- `agent-docs/exec-plans/active/2026-04-26-linq-api-typing-repro.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/linq-typing-repro.test.ts --no-coverage`
- `pnpm typecheck`
- `git diff --check -- scripts/linq-typing-repro.ts scripts/linq-typing-repro.test.ts agent-docs/exec-plans/active/2026-04-26-linq-api-typing-repro.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
