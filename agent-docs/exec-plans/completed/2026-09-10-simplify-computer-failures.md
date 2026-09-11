# Remove dead computer failure plumbing

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Remove unused computer-adapter parameters and redundant result state while preserving every tool request, response, failure classification, and effect.

## Success criteria

- The adapter has one actual uncertainty policy, no unread outcome flag, and no unused pause finish path.
- Focused deterministic transport/error tests, assistant-engine typecheck, complexity guard, and source/privacy review pass.
- The original session owns final candidate review, Ready admission, ReviewGPT, and CI after this lane opens a draft PR.

## Scope

- In scope: private computer adapter functions in dynamic-tools.ts, focused tests, and implementation evidence.
- Out of scope: tool schemas/descriptions, transport or provider contracts, sanitizers, retries, pause locking, phone calls, and other module extractions.

## Constraints

- Keep known failures distinct from uncertain execution. Uncoded 5xx and the three existing browser-execution error codes remain uncertain; other coded failures remain known.
- Keep one POST per accepted tool operation, the original abort signal and body, no automatic retry or finish, and unchanged diagnostics.
- Keep web-owned browser state and assistant-codex pause locking with their current owners. No new abstraction, dependency, state, or deployed protocol.

## Risks and mitigations

1. An uncertain failure must not become permission to retry blindly. Exact result-text matrices cover transport, JSON-read, coded, uncoded, and malformed-response failures.
2. Pause must retain the member-gated handoff and never call finish after failure. Existing composed tests protect its sanitization and single-call behavior.
3. Failure telemetry must preserve its finite classification. Direct tests compare failureDiagnostic and the outer runtime-issue projection.

## Tasks

1. Prove private callers, constant policy arguments, duplicate branch, unused finish path, and current owners.
2. Add focused outcome matrices; delete the proven dead plumbing without reorganizing the adapter.
3. Run focused tests, package typecheck, complexity review, and full diff/privacy checks.
4. Archive implementation evidence, commit with neutral identity, push and open a draft PR for the original completion owner.

## Decisions

- Base: b80bd40f84d1b367c1810e2fe046e3089cc28aa4.
- All five computer operations enable the same uncertainty policy. The returned unknownOutcome flag is read only by identical pause branches and never reaches the model or telemetry.
- The unused finish path uses the same pure route encoding as the real pause path; removing it does not remove an effect or input validation.
- The assistant verification skill was read. Live-model proof is not applicable to this cleanup: tool schemas, model-visible strings and decoded values, authority, effect restrictions, and request ordering are unchanged. Deterministic composed tests and source review prove the removal.
- Internal refactor: no member-visible changelog item or initial provider-input measurement is applicable.

## Verification

- Passed: `MURPH_VITEST_MAX_WORKERS=2 pnpm --filter @murphai/assistant-engine test test/assistant-codex-computer-tools.test.ts` — 61 tests, including 26 new outcome-matrix cases.
- Passed: `MURPH_TSC_PACKAGE_CHECKERS=2 pnpm --filter @murphai/assistant-engine typecheck`.
- Passed: `pnpm complexity:diff --base b80bd40f84d1b367c1810e2fe046e3089cc28aa4` — debt 534 and maximum 189 unchanged; thirteen unrelated dispatch/domain hotspots reviewed and kept outside this focused deletion.
- Passed: parent source/test candidate review, full diff review, and `git diff --check`. Production source has a net deletion of 44 lines.
- Passed: frozen dependency install; Frog list inspected and no new workaround or entry needed.
- Live-model proof: not applicable; no model-visible contract or behavior changes, and no live pass claimed.
- Original completion owner retains final candidate admission, exact-head CI, and ReviewGPT.
Completed: 2026-09-10
