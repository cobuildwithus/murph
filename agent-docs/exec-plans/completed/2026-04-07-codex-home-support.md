# Persist explicit Codex-home selection for Murph assistant defaults and sessions

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Let Murph save an explicit Codex home for the Codex CLI backend, offer lightweight local-home selection in shared setup/model flows, and keep resumed sessions pinned to the same home that created them.

## Success criteria

- Codex-backed assistant defaults can persist a nullable `codexHome` field.
- New assistant sessions persist the effective Codex home in provider/session state so resume keeps using the same home that started the session.
- Interactive `murph model` and the shared setup assistant flow let operators choose ambient mode, a discovered home, or a manual path without introducing a separate account-management subsystem.
- Codex child execution scopes `CODEX_HOME` only when an explicit home is saved; explicit saved homes fail closed instead of silently falling back.
- Focused verification and a direct CLI proof pass before commit.

## Scope

- In scope:
- `packages/operator-config/**`
- `packages/setup-cli/**`
- `packages/assistant-engine/**`
- `packages/cli/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- This active plan
- Out of scope:
- Murph-owned managed Codex account creation or `codex login` orchestration
- Deep recursive filesystem discovery of arbitrary Codex homes
- Hosted assistant provider changes

## Constraints

- Technical constraints:
- Reuse the existing assistant provider normalization/serialization seams instead of adding parallel Codex-home plumbing.
- Keep discovery advisory only; manual path entry must remain available.
- Preserve non-interactive CLI behavior and explicit flags.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the normal repo verification and completion-review flow for repo code changes.

## Risks and mitigations

1. Risk: A saved explicit home could be lost during session creation or failover, causing resume to hit the wrong account.
   Mitigation: Thread `codexHome` through provider config, backend targets, provider session options, and turn-route overrides before wiring UI.
2. Risk: Discovery heuristics could become the durable source of truth and misroute users with unusual local layouts.
   Mitigation: Keep discovery shallow and suggestion-only, with ambient mode plus manual path entry as first-class options.
3. Risk: An explicit missing home could silently fall back to ambient `CODEX_HOME` and mask account mixups.
   Mitigation: Validate and normalize the explicit path and fail closed when it is unreadable or missing at execution time.

## Tasks

1. Add plan/ledger coverage for the Codex-home feature lane.
2. Extend assistant backend/session/provider schemas and normalization to carry a nullable `codexHome` field.
3. Add a shared setup/model Codex-home selection path with ambient, discovered, and manual-entry modes.
4. Scope Codex child env from the selected home, add focused regression tests and direct CLI proof, then run required audit/verification and finish with a scoped commit.

## Decisions

- Use explicit nullable `codexHome` as the durable source of truth; `null` means ambient/default behavior.
- Stamp the effective `codexHome` into new session/provider state so resume stays pinned even if defaults later change.
- Keep initial discovery shallow and local-only; do not adopt CodexBar-style managed-home/account creation as part of this feature.
- Keep Codex-home validation and path normalization package-local for now instead of adding a new cross-package helper surface; the current repo package-reference shape makes that abstraction heavier than the duplicated logic it would replace.

## Verification

- Commands to run:
- `./node_modules/.bin/tsc -p packages/operator-config/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/setup-cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-engine/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `cd packages/cli && ../../node_modules/.bin/vitest run --config vitest.config.ts test/assistant-cli.test.ts test/setup-cli.test.ts test/assistant-provider.test.ts test/assistant-service.test.ts test/assistant-codex.test.ts`
- Expected outcomes:
- Saved Codex-home defaults persist cleanly, interactive model/setup can choose them, and resumed Codex sessions keep using the saved home.
- Results:
- `operator-config`, `setup-cli`, `assistant-cli`, and `cli` typecheck passed.
- `assistant-engine` typecheck still fails for pre-existing unrelated `integrated-services` and `workout-*` errors outside this lane.
- Focused Vitest passed: 5 files, 226 tests.
- Direct CLI proof passed: a temp operator home with a saved explicit Codex home returned that `codexHome` and note through `node packages/cli/dist/bin.js model --show --format json`.
Completed: 2026-04-07
