Goal (incl. success criteria):
- Debug hosted Linq/iMessage audio-only voice memo failure without assuming snapshot restore is root cause.
- Success means focused proof for the fresh incoming audio path, narrowed failure candidates, and no speculative restore-policy change.

Constraints/Assumptions:
- Preserve unrelated dirty work and active Linq/web/Health Commons rows.
- Do not broaden into Linq webhook routing or parser provider behavior.
- Treat raw inbox media as sensitive vault data; avoid logging paths or payloads.

Key decisions:
- Treat generic Linq `media` with `audio/mp4` as the relevant iMessage-style case; `voice_memo_part_count: 0` is a clue but not a required parser condition.
- Do not change snapshot restore policy unless evidence shows deferred parser retry is the active failure.

State:
- Logging-only instrumentation added for hosted parser drain failures and observed failed parser job state while root-cause analysis continues.

Done:
- Traced Linq hosted conversation import, inbox persistence, parser drains, and hosted bundle restore.
- Identified `.m4a` raw attachments are externalized by extension and skipped by restore.
- Added a hosted workspace entrypoint regression that externalizes a `raw/inbox/**/01__audio-message.m4a` artifact and asserts it is present when mailbox import starts.
- Ran the focused regression; it fails with `ENOENT` for the restored inbox audio path before any restore-policy fix.
- Removed the speculative restore regression at user request.
- Added a hosted Linq audio E2E test that mocks generic iMessage `media` / `audio/mp4` download, fake ffmpeg, and fake parser.
- Ran the focused hosted Linq audio test; it passes on current code, proving the fresh-message path stores bytes, writes transcript text, and indexes transcript when download/parser succeed.
- Confirmed hosted-local Linq webhook E2E currently injects `/app/test-parser-toolchain/*`, so it cannot catch production ffmpeg/whisper or missing-restored-media failures.
- Updated the failure hypothesis from "ingest did not materialize bytes" to "ingest wrote raw bytes, but snapshot restore skipped externalized raw artifacts."
- Reverted the broad source/test changes after deciding eager raw-artifact restore is too blunt.

Now:
- Reproduced the hosted-local Linq audio parser failure path with the current runner bundle. The assistant prompt still receives failed attachment state instead of transcript text when the parser toolchain is absent/mismatched.
- Follow-up evidence: no parser-specific durable rows landed in the repro database, so the visible `parseState: failed` is not yet being surfaced by the parser-drain log point alone.

Next:
- Trace parser drain ordering, hosted checkpoint timing, and the assistant context path that surfaces failed attachment state before changing restore/materialization behavior.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: The reported capture exists only in a hosted runner snapshot not present on local disk.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/parsers/src/pipelines/resolve-attachment-artifact.ts`
- `packages/parsers/src/pipelines/worker.ts`
- `packages/parsers/test/parsers.test.ts`
- `apps/cloudflare/package.json`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
- `.tmp/linq-parser-log-repro-explicit-2` (local repro output only)
- `agent-docs/exec-plans/active/2026-04-29-hosted-inbox-artifact-restore.md`
