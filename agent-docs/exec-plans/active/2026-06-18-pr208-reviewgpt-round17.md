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

- Superseded by round 18: import payload timestamp schemas briefly matched runtime Date.parse compatibility, then were restored to strict advertised contracts.
- Superseded by round 18: event JSONL row schemas briefly accepted optional `dayKey`, then were restored to reject caller-controlled local-day values.
- Implemented: no-op timezone propagation was removed from timestamp normalization helpers.
- Verification passed: focused contracts, CLI, core, and vault-usecases tests.
- Verification passed: package typechecks for contracts, CLI, core, and vault-usecases.
- Verification passed: `scripts/workspace-verify.sh test:diff` for the touched files.
- Verification passed: root `pnpm typecheck`, `pnpm build:workspace:incremental`, `pnpm test:smoke`, `git diff --check`, and privacy scan.
- Committed and pushed as `a60ab714c`.

## Round 18 Follow-up

ReviewGPT round 18 found three accepted issues:

- Caller-controlled event JSONL `dayKey` can misfile health events and contradicts command-surface docs.
- Date.parse-compatible timestamp schemas are not expressible in emitted JSON Schema and can shift dates by host/vault timezone.
- Encounter import advertises a strict schema but runtime still normalizes through a separate parser that silently drops misspelled fields.

Next:

1. Remove `dayKey` from event JSONL payload schemas and reject it at runtime.
2. Restore advertised import timestamp schemas to strict offset-qualified ISO date-times.
3. Validate raw encounter payloads through `encounterBundlePayloadSchema` before normalization.
4. Add tests for emitted JSON Schema parity, typos, and runtime rejection.

Status:

- Implemented: event JSONL runtime now validates rows through the advertised per-kind schema before normalization.
- Implemented: blood-test, event JSONL, and encounter advertised timestamp schemas use strict `date-time`.
- Implemented: encounter raw payloads are schema-validated before write after the existing friendly normalizer checks run.
- Implemented: tests now cover emitted JSON Schema parity for invalid timestamps and event JSONL `dayKey`.
