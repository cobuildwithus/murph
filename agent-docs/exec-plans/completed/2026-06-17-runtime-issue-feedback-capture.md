# Runtime Issue Feedback Capture

## Goal

Land the implementation plan from `agent-docs/exec-plans/completed/feedback.md` by routing already-observed Codex/provider/action failures into the existing assistant-runtime issue pipeline.

## Success Criteria

- No model-visible feedback tool, prompt self-reporting, new DB table, new queue, or daily LLM job is added.
- Assistant-engine carries privacy-safe `runtimeIssueInputs` metadata that stays out of transcripts and model-visible events.
- Failed Codex command/tool actions, dynamic tool failures, dynamic tool validation failures, and terminal provider failures produce bounded issue inputs without raw command, output, path, prompt, transcript, vault content, URL, email, or phone details.
- Dynamic tool validation failures include a parser-owned, value-free validation digest with safe keys/paths, missing/invalid/unknown structural facts, and a digest fingerprint for SQL grouping.
- Runtime issue writes are fire-and-forget on the successful reply path.
- Hosted pending issue export is verified or wired after durable workspace checkpoint work, with export failure non-fatal.
- Focused tests and required repo verification pass or have a documented unrelated blocker.

## Non-Goals

- No generalized feedback abstraction.
- No Prisma migration.
- No member-level drilldown or per-member relation on issue rows.
- No cleanup-only removal of `rawToolEvents` unless it is proven unused and low-risk inside this task.

## Scope

Expected files:

- `packages/assistant-engine/src/assistant/issue-reporting.ts`
- `packages/assistant-engine/src/assistant/tool-validation-digest.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant/codex-runtime.ts`
- `packages/assistant-engine/src/assistant/codex-turn-runner.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/action-diagnostics.ts`
- focused tests under `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime.ts` and focused hosted-runtime tests only if export wiring is missing

## Verification Plan

- Run focused assistant-engine tests covering issue recording, Codex action extraction/metadata, and turn-runner best-effort behavior.
- Run hosted-runtime issue tests if export wiring changes.
- Run `pnpm typecheck`.
- Run the required completion audit passes for the final routed task class.

## State

- Done: Source plan read. Existing issue writer/export/import surfaces found. Metadata capture, best-effort recording, hosted issue export, parser-owned validation digests, and focused tests are implemented.
- Now: Resolve completion-audit findings for idle-time write flushing, durable export/checkpoint ordering, and string exit-code command failures.
- Next: Rerun focused verification/audits, close the active plan, and create the scoped commit.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
