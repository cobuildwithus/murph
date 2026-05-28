# Codex action diagnostics

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Add a metadata-only Codex action diagnostic summary for hosted assistant
  turns so usage spikes can be explained by action counts, durations, output
  item counts, and token samples without logging prompts, transcripts, tool
  inputs, tool outputs, files, paths, or raw identifiers.

## Success criteria

- Codex app-server turns accumulate diagnostics in memory from events already
  handled by Murph.
- Successful hosted turns emit at most one bounded redacted diagnostic summary
  through the existing provider trace/log path.
- Hosted runtime log parsing preserves only shallow safe scalar metadata.
- Focused tests prove the reducer, emission path, and hosted redaction path.

## Scope

- In scope:
  - `packages/assistant-engine` Codex app-server event reducer and trace
    emission.
  - `packages/assistant-runtime` hosted provider trace parser for the new
    summary event.
  - Focused unit tests.
- Out of scope:
  - New tables, queues, workers, external observability providers, or per-event
    writes.
  - Raw prompt, transcript, attachment, tool argument, tool output, command
    output, provider response, file path, or user/contact identifier logging.

## Constraints

- Technical constraints:
  - No storage writes during the Codex event stream; only in-memory reduction.
  - Emit one bounded summary event per turn, best-effort, via existing trace
    plumbing.
  - Keep arrays capped and values shallow so existing hosted runtime log
    sanitizer accepts the payload.
- Product/process constraints:
  - Prefer simple composable primitives over a separate telemetry system.
  - Preserve privacy guardrails for health data and hosted runtime logs.

## Risks and mitigations

1. Risk: diagnostics accidentally capture raw payloads or identifiers.
   Mitigation: reducer stores only fixed action-kind buckets, counts,
   booleans, durations, bounded output item counts, and token counts; hosted
   parser allowlists the final keys.
2. Risk: diagnostics add reply latency.
   Mitigation: no log I/O in the event handler; write one existing best-effort
   hosted log entry after the runtime delivery phase.

## Tasks

1. Add a Codex action diagnostics reducer under the Codex app-server owner.
2. Emit one summary trace when a turn finishes.
3. Parse and sanitize the new trace in hosted runtime provider diagnostics.
4. Add focused tests for reducer behavior and hosted redaction.
5. Run scoped verification and completion audits.

## Decisions

- Store diagnostics in existing hosted runtime logs, not a new persistence
  surface.
- Emit a versioned schema event
  `murph.assistant-codex-action-diagnostics.v1`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-engine/src packages/assistant-engine/test packages/assistant-runtime/src packages/assistant-runtime/test`
- Expected outcomes:
  - Typecheck and focused diff-aware tests pass, or any unrelated blocker is
    clearly identified with focused proof for this slice.
Completed: 2026-05-27
