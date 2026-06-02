# Blood test result input UX

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Make `blood-test save --result` safer for assistant callers when structured result text contains semicolons or other compact-parser separators, while preserving the existing compact `key=value` result syntax.

## Success criteria

- `blood-test save` accepts a repeatable `--result` value as either the current compact field string or one JSON object per analyte.
- JSON result objects round-trip semicolon-containing `referenceRange.text` without requiring delimiter escaping.
- Malformed JSON result input fails before any canonical event write and does not echo health payload text.
- Command schema/help descriptions make the safer JSON-object result path discoverable to agents.
- Runtime and shipped config schema descriptions make the safer JSON-object result path discoverable to agents.
- Focused CLI tests and required repo verification/audits pass or have a documented unrelated blocker.

## Scope

- In scope: `packages/cli/src/commands/health-blood-test-save.ts`, focused CLI tests, generated CLI/config metadata required by command discovery.
- Out of scope: canonical blood-test schema changes, core storage changes, new persisted state, import-json payload semantics, broad CLI command graph refactors.

## Constraints

- Technical constraints: keep canonical writes in `packages/core`; keep CLI as a thin parser/delegator; avoid new abstractions unless needed for this parser seam.
- Product/process constraints: health data is high-sensitivity; parser errors must not print raw result payloads or private lab text.

## Risks and mitigations

1. Risk: widening `--result` could blur compact and JSON modes.
   Mitigation: select JSON mode only when the trimmed value starts with `{`; compact syntax remains unchanged otherwise.
2. Risk: invalid JSON errors could leak supplied health text.
   Mitigation: emit metadata-only CLI errors and rely on schema issues rather than echoing raw input.

## Tasks

1. Done: traced current parser, command schema, and tests.
2. Done: added JSON-object parsing for each `--result` entry.
3. Done: added focused tests for semicolon-rich reference-range text, malformed JSON, and JSON array guidance/no-write behavior.
4. Done: updated runtime command descriptions/examples and regenerated shipped config schema metadata so discovery points at the JSON-object path.
5. Done: ran focused verification and required audits; scoped commit workflow remains.

## Decisions

- Keep the existing `--result` option rather than adding `--result-json`; this avoids another parallel input knob while giving agents a delimiter-safe structured mode.
- Select JSON mode only when the trimmed `--result` value starts with `{`; reject arrays with guidance to repeat `--result` or use `blood-test import-json`.

## Verification

- Passed: `pnpm --dir packages/cli test -- health-blood-test-save.test.ts` (98 files / 854 tests) before coverage-worker test addition.
- Passed: `bash scripts/workspace-verify.sh test:diff packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts` before coverage-worker test addition (CLI typecheck and 98 files / 854 tests).
- Passed: `bash scripts/workspace-verify.sh test:diff packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts` after coverage-worker test addition (CLI typecheck and 98 files / 855 tests).
- Passed: `pnpm --dir packages/cli gen:config-schema`.
- Passed: `bash scripts/workspace-verify.sh test:diff packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts` after schema regeneration (CLI targeted verification, package-shape verification, 22 files / 363 tests).
- Passed: `git diff --check -- packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts agent-docs/exec-plans/active/2026-06-02-blood-test-result-input-ux.md`.
- Blocked by unrelated dirty work: `pnpm typecheck` failed in `scripts/hosted-local-e2e.test.ts` on pre-existing TypeScript errors about `.env` missing from `{ args; command }`.
- Audits: security/privacy review found no findings; coverage-write added JSON-array no-write proof; final completion review found stale `packages/cli/config.schema.json`, fixed by regeneration and post-fix CLI targeted verification.
Completed: 2026-06-02
