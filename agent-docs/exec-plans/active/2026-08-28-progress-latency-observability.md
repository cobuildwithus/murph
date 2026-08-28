# Improve progress latency guidance and diagnostics

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Make one early member-visible progress update more likely for reply-critical
  multi-source or multi-step work without increasing routine status chatter.
- Make slow-reply investigations distinguish no model attempt, a late attempt,
  and failed progress delivery without retaining content or raw provider ids.

## Scope

- Direct-conversation progress guidance in the shared model behavior prompt.
- Codex action and completion-timing diagnostics plus hosted-runtime log
  redaction and durable projection.
- Deterministic prompt, diagnostics, privacy, and focused real-model coverage.
- No host timer, automatic progress sender, delivery queue, or group-progress
  policy change.

## Tasks

1. Replace redundant progress wording with two high-level sentences that favor
   one early update for distinct-source or multi-step work and reconsider the
   decision on resumed turns.
2. Add bounded provider-turn correlation plus progress call, sent, failed, and
   first-call timing fields to metadata-only diagnostics.
3. Prove prompt size, action aggregation, log redaction/projection, shared
   correlation, type safety, and privacy guards.
4. Run and review one focused production-derived real-model journey.

## Verification

- Focused deterministic Vitest suite: 6 files passed, 193 tests passed, and 87
  opt-in cases skipped.
- Assistant Engine and Assistant Runtime package typechecks passed.
- The first focused multi-source target-model probe reproduced the no-progress
  gap under weaker wording. After the final two-sentence guidance, the focused
  `gpt-5.6-terra` subscription journey sent exactly one progress update before
  its bounded activity, meal, and sleep reads and returned a concise,
  non-repetitive, appropriately qualified synthesis. UX verdict: Ready. No real
  member, site, or external state was used.
- `pnpm logs:guard` and `pnpm docs:drift` passed. `git diff --check` and the
  final privacy scan passed after the implementation; repeat both at handoff.
