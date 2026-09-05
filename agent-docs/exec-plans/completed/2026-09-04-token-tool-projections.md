# Reduce assistant tool output without losing evidence

Status: completed
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
- Parent scoped source review found no authority, privacy, completeness, legacy contract, or simplification issues. Final source review passed; required CI is checked again on the final proof-only closure head.

## CI fixture maintenance

- Exact CLI help guidance, two route-plan characterization hashes, and five scenario command labels now match the additive options. Scenario labels are descriptive integrity metadata; no scenario invocation changed.
- Complete baseline/candidate plan captures differ only by the two intended prompt bullets in direct and scheduled-email plans and their derived fingerprints/cache metadata. All other fields and group, maintenance, and output-only plans are identical. The bounded resident fixture measures 67,678 -> 68,362 characters (+684); its ceiling moves from 67,682 to 68,366, preserving the four-character margin.
- Focused maintenance verification passes: 184 tests across the complete route-planning and model-behavior files, one CLI help test, scenario integrity (207 scenarios, 12 inputs, 29 golden directories), and CLI/assistant-engine typechecks. Parent reviewed all eight proof-only file diffs and approved them under the review loop's isolated non-substantive proof exception; production source, runtime configuration, schemas, and implemented contracts remain identical to the reviewed candidate.

## Final review disposition

- PR #2876 source candidate `e0cb5367a3e9e4214da35c7c0b834f614935f516` received a valid round-one ReviewGPT PASS on gpt-6-pro. Retry four completed naturally in 498.794 seconds; exact committed-turn identity, response-file hash, model, and completion markers match capture metadata. Earlier too-fast diagnostic passes were excluded from the review gate. The reviewer inspected all 22 changed files and 57 hunks and ran 54 isolated projection checks plus a limit-preservation check; no qualifying findings remain.
- Parent approved the eight isolated proof-fixture corrections after full before/after prompt comparison and focused verification. This closure changes only those proof files and this explanatory plan; production source and implemented contracts are byte-identical to the reviewed candidate, so the documented non-substantive review exception applies.
- Canonical/live/generated/typecheck proof and parent review are complete. Required CI is verified on the final pushed head; no deploy or merge is authorized or performed.
Completed: 2026-09-04
