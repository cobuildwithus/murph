# Improve progress latency guidance and diagnostics

Status: active
Created: 2026-08-28
Updated: 2026-08-29

## Goal

- Make one early member-visible progress update more likely for reply-critical
  multi-source or multi-step work without increasing routine status chatter.
- Make slow-reply investigations distinguish no model attempt, a late attempt,
  and unsent progress delivery without retaining content or raw provider ids.

## Scope

- Direct-conversation progress guidance in the shared model behavior prompt.
- Codex action and completion-timing diagnostics plus hosted-runtime log
  redaction and durable projection.
- Deterministic prompt, diagnostics, privacy, and focused real-model coverage.
- No host timer, automatic progress sender, delivery queue, or group-progress
  policy change.

## Tasks

1. Replace redundant progress wording with one ordered rule that favors one
   early update for distinct-source or multi-step work and reconsiders the
   decision on resumed turns.
2. Add bounded provider-turn correlation plus progress call, sent, and
   first-call timing fields to metadata-only diagnostics; derive unsent calls
   from completed calls minus sent outcomes.
3. Prove prompt size, action aggregation, log redaction/projection, shared
   correlation, type safety, and privacy guards.
4. Run and review one focused production-derived real-model journey.

## Verification

- Focused deterministic Vitest suite on the rebased candidate: 6 files passed,
  207 tests passed, and 137 opt-in cases skipped.
- Assistant Engine and Assistant Runtime package typechecks passed.
- The first focused multi-source target-model probe reproduced the no-progress
  gap under weaker wording. A rebased candidate with optional `Prefer` wording
  reproduced it again with zero progress calls, confirming the remaining prompt
  ambiguity. After the final two-sentence imperative guidance and single-read
  exception clarification, the focused `gpt-5.6-terra` subscription journey
  sent exactly one progress update before its bounded activity, meal, and sleep
  reads and returned a concise, non-repetitive, appropriately qualified
  synthesis. UX verdict: Ready. No real member, site, or external state was
  used.
- Complete normalized first-provider request capture used the pinned real Codex
  App Server, identical synthetic direct/group fixtures, `gpt-5.6-terra`, low
  reasoning, production code mode, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. Direct changed from 27,242 tokens / 125,123 UTF-8 bytes to
  27,238 / 125,138 (-4 tokens, -0.0147%; +15 bytes, +0.0120%); group stayed
  exactly 23,365 / 107,589. The direct delta is entirely assembled `input`
  instructions; tool/schema/generated guidance and all other serialized
  provider-visible fields are unchanged. The temporary capture harness and
  payloads were removed.
- `pnpm logs:guard` and `pnpm docs:drift` passed. `git diff --check` and the
  final privacy scan passed after the implementation; repeat both at handoff.
- After final-review remediation, `pnpm logs:guard`, `pnpm docs:drift`, JSON
  parsing, and `git diff --check` passed again. Focused local Vitest runs entered
  the runner but produced no test result after 15 minutes, and the package
  typecheck produced no diagnostic or result after 10 minutes; only the exact
  owned processes were stopped. Exact-head PR CI remains the required
  test/typecheck gate before merge.
