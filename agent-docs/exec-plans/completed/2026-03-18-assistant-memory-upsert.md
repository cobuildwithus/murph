# Assistant memory extractor/upsert tightening

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Tighten assistant memory extraction so long-term memory only captures durable health context and stable user instructions/preferences.
- Replace mutable identity/preference facts instead of appending conflicting bullets forever.
- Preserve the existing bootstrap-memory injection model while reducing false positives and one-off prompt pollution.

## Success criteria

- Health memory only persists clearly durable health context such as meds, allergies, diagnosed conditions, tracked metrics, stable baselines, or explicit remember requests.
- Transient concerns, questions, and symptoms-of-the-moment do not become long-term health memory by default.
- Identity parsing strips conversational tail text so `call me Alex from now on` becomes just the durable name memory.
- Mutable long-term memories such as user name and unit/style preferences replace earlier bullets within the same section instead of accumulating.
- Focused tests cover the new extractor and bootstrap behavior.

## Scope

- In scope:
  - `packages/cli/src/assistant/memory.ts` extraction and long-term merge semantics
  - small shared helper support if needed
  - focused assistant state/service tests
- Out of scope:
  - storage-format changes
  - provider bootstrap removal
  - cross-process file locking or broader runtime serialization

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts --no-coverage --maxWorkers 1`
- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Notes

- User direction prioritizes extractor/upsert trustworthiness over storage redesign.
- Keep the change local to assistant memory behavior unless a failing test forces a tiny adjacent update.

## Outcome

- Assistant memory extraction now prefers durable health context and ignores transient concerns, symptoms, and one-off prompt phrasing by default.
- Mutable identity and response-style memories now replace older long-term bullets instead of accumulating conflicting entries.
- Fresh-session bootstrap memory now collapses overridden daily notes so the latest mutable value is what gets re-sent upstream.

## Verification results

- Focused assistant verification passed:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts --no-coverage --maxWorkers 1`
- Required checks passed:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Completed: 2026-03-18
