# PR 208 ReviewGPT Round 17

## Goal

Fix accepted ReviewGPT round 17 findings for PR 208's payload-schema surface.

Success means:

- blood-test, event JSONL, and encounter payload schemas match the current importers' accepted timestamp grammar;
- event JSONL schemas include the legacy-compatible `dayKey` input that the importer preserves;
- no-op timezone parameters introduced during earlier review rounds are removed;
- focused tests, package typechecks, diff-aware verification, root typecheck, build, smoke, whitespace, and privacy checks pass;
- ReviewGPT is rerun after the pushed fix.

## Scope

- `packages/contracts/src/zod.ts`
- payload-schema tests and generated schema artifacts
- encounter payload schema/tests
- core timestamp normalization plumbing touched by earlier rounds
- blood-test CLI regression coverage

## Constraints

- Preserve current importer compatibility; do not silently tighten existing JSON import commands.
- Keep the fix narrow and avoid new compatibility abstractions beyond shared schema grammar.
- Do not expose local identifiers, secrets, raw health payloads, or absolute local paths in committed files.

## Plan

1. Align writable timestamp schemas with current core `DateInput` acceptance.
2. Add `dayKey` to event JSONL payload schemas.
3. Remove unused timezone threading from core helpers.
4. Update focused tests and generated schemas.
5. Run verification, commit, push, and rerun ReviewGPT.

## Status

- Implemented: import payload timestamp schemas now match current runtime compatibility.
- Implemented: event JSONL row schemas accept optional `dayKey`.
- Implemented: no-op timezone propagation was removed from timestamp normalization helpers.
- Verification passed: focused contracts, CLI, core, and vault-usecases tests.
- Verification passed: package typechecks for contracts, CLI, core, and vault-usecases.
- Verification passed: `scripts/workspace-verify.sh test:diff` for the touched files.
- Verification passed: root `pnpm typecheck`, `pnpm build:workspace:incremental`, `pnpm test:smoke`, `git diff --check`, and privacy scan.
- Next: commit, push, and rerun ReviewGPT.
