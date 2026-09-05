# Reduce assistant tool output without losing evidence

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Reduce irrelevant assistant tool-result content while preserving canonical facts, units, dates, coverage, authorization, and full-detail caller contracts.

## Success criteria

- Explicit workout-summary output retains every bounded workout and all summary fields, with an explicit marker that splits were omitted; existing full detail remains unchanged.
- Explicit record-only memory reads return the exact requested record; compact mutation receipts retain the changed record and success outcome without repeating the whole document.
- Existing defaults and full-document/full-detail callers remain compatible.
- Focused deterministic tests, generated CLI surface checks, relevant typechecks, and production-derived synthetic assistant journeys pass with reviewed replies.

## Scope

CLI and existing vault-usecase projections, tests, generated CLI metadata, and owning documentation. No canonical schema or persisted state changes, health-policy changes, production actions, deploys, or merges. Runtime skill restructuring belongs to a separate coordinated change.

## Evidence and architecture

Activity detail currently couples per-workout summary facts to up to 64 splits per workout. A targeted compact memory read still repeats the entire document; mutations return the full document and selected record. Extend existing public CLI options and query projection only; no new services, caches, or state owners. Keep full legacy options as implemented for existing consumers.

## Product UX

Outcome: answer workout-summary and exact-memory requests with less irrelevant context and unchanged evidence.
Reaches: private assistant workout facts and authorized memory updates; full split analysis and complete-memory conflict checks keep existing full reads.
Proof: synthetic dense workouts, whole-document versus exact-record comparisons, persisted mutation readback, and focused real-assistant action/reply review.

## Risks and mitigations

- Omitted splits could look absent: mark omission explicitly and preserve full detail.
- Memory projections could hide conflict context: new read mode requires a record id; full-document reads remain available and unchanged.
- Runtime guidance can lag CLI rollout: additive options only, co-packaged command hints, and explicit generated metadata proof; coordinate skill adoption separately.

## Tasks

1. Trace consumers and extend additive compact projections.
2. Prove data equivalence, meaningful byte reductions, full compatibility, and generated schema parity.
3. Run focused live journeys and relevant typechecks; review candidate and privacy.
4. Open draft PR, obtain parent review, then run applicable CI and ReviewGPT gates.

## Verification

- Source CLI projection tests pass: exact records and all mutation outcomes preserve canonical metadata; dense workout summaries are 23,431 bytes versus 774,247 full-detail bytes (96.97% less), while retaining all 32 bounded workout summaries.
- Vault-usecase, CLI, and assistant-engine typechecks pass. Workout omission-schema, skill guidance, resident prompt, and bounded bootstrap hint tests pass.
- Complexity guard passes for six changed source files. Existing prompt-builder hotspots (30 and 25) are unchanged; no added complexity debt.
- Native Codex first-request capture with identical synthetic direct/group fixtures: individual normalized provider input 166,647 → 167,355 bytes (+708, +0.425%); group 128,210 bytes unchanged. Exact target tokenizer is unavailable locally; diagnostic o200k_harmony counts are not billed-token evidence.
- Generated CLI artifact regeneration passes through the normal prepared-runtime build; source manifest/config/types and skill-hash parity tests pass (11 tests). Focused real-assistant memory adoption passes after restoring the production bootstrap contract in the fixture: one compact update, one exact-record readback, correct confirmation, and unrelated records preserved. Workout-summary and full-split real-assistant journeys pass, each with exactly one correct-level activity read and accurate concise replies. UX Ready for all three journeys. Content-only changelog tests pass (9 tests); Web typecheck passes.
- Parent scoped source review found no authority, privacy, completeness, legacy contract, or simplification issues. Final exact-head review and PR gates remain pending.
