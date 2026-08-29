# Improve progress latency guidance and diagnostics

Status: completed
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
- The first remediation head reached PR CI and exposed two test-only TypeScript
  narrowing errors in the new composed cap proof; production sources compiled.
  The follow-up narrows the redacted detail shape without changing runtime
  behavior. The replacement exact head passed the full required PR CI matrix,
  including release build/typecheck, Web verification, package coverage, repo
  hygiene, and deployment checks. Its exact-head ReviewGPT round passed with no
  qualifying findings.
- The final-prompt subscription journey sent exactly one natural update before
  the source reads, oriented to activity/meals/sleep and the full-day takeaway,
  disclosed no result or internal mechanic, and returned all fixture facts. UX
  verdict: Ready. Its only failed assertion rejected the natural compound
  phrase "three-meal day" while accepting "three meals"; the focused proof now
  accepts both forms. A post-adjustment subscription rerun remained silent in
  the local transform/import harness for 30 minutes and was stopped through its
  exact owned session without a test result; the completed journey remains the
  behavioral evidence because neither production code nor generated output
  changed.
- Exact-head CI at `aea294326c960f5ebbde4193fa9b1cb6c5ec6636` passed 26
  checks with two intentional skips and no pending or failed check. Final
  ReviewGPT round 3 found no tactical defect and returned the mandatory
  round-number `RETROSPECTIVE_REQUIRED` outcome. The requirement-level decision
  below was recorded before another review round.

## Round-3 retrospective

- Original requirement: provide one early useful update for direct
  reply-critical multi-source or substantive multi-step work, keep routine
  single reads and group conversations quiet, and make the same path diagnosable
  with metadata only.
- The immutable first-reviewed head changed 14 files and 509 lines, including
  80 authored production-source lines. The current head still changes 14 files
  and 600 lines, while production-source churn decreased to 70 lines. Review
  remediation changed 191 lines in the same files; the immediate round-3 delta
  is 18 additions and four deletions in proof and documentation only.
- Review removed duplicated prompt wording, a derivable failure counter, and a
  duplicated action-row ordinal. The remaining growth is semantic live-journey,
  parser/cap, type-narrowing, and durable evidence coverage, not runtime
  machinery.
- Decision: explicitly continue as one indivisible delivery. The prompt owns
  the member outcome, diagnostics explain the same decision and delivery path,
  tests prove their shared boundary, and the changelog communicates the result.
  Splitting them would discard one of those guarantees and add rollout/review
  overhead for only 70 production-source lines.
- Retain only the shared direct-progress rule, existing progress tool and Codex
  turn wiring, action reducer, numeric timing correlation, and existing hosted
  trace projection/caps. The final boundary adds no sender, timer, scheduler,
  queue, state machine, lifecycle, reconciliation path, schema, persisted state,
  or policy owner; no further production expansion is justified.
- Sufficient continuation proof is the focused deterministic suite and package
  typechecks, parser-produced cap and privacy/log guards, one completed synthetic
  production-derived live journey with a Ready verdict, changelog source and
  production-presentation evidence, exact-head CI, and one full-snapshot
  ReviewGPT pass after this retrospective.
- Final ReviewGPT round 4 reviewed the complete sensitive snapshot at
  `9e37d83129fd450809a024f28cfb0d2c29dce130`, verified the retrospective and
  every prior correction, found no qualifying issue or remaining net-deletion
  opportunity, and returned `ROUND_OUTCOME: PASS`. The requested-model sidecar
  confirms the GPT-5.6 Sol lane. Exact-head CI passed 26 checks with two
  intentional skips and no pending or failed check.
- Parent final review re-read the complete production diff and changed call
  paths, confirmed the shared correlation is bounded and content-free, unsent
  progress remains derived from completed-minus-sent counts, both existing log
  caps retain the intended fields, and no additional fix or abstraction is
  warranted.
Completed: 2026-08-29
