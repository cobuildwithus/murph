# Typed CLI Inputs

## Goal

Make high-value incur CLI write surfaces easier and safer for agents by replacing canonical untyped JSON-file/stdin inputs with typed args/options, while preserving explicit JSON import escape hatches for batch or advanced cases.

Success criteria:
- Common agent write commands expose concrete typed schemas through incur.
- JSON file/stdin remains available only as clearly named import-style fallback where it is still necessary.
- Generated incur metadata and focused tests reflect the new canonical command surfaces.
- Existing unrelated CLI, Health Commons, hosted, and assistant-runtime work in the shared checkout is preserved.

## Scope

Primary targets:
- Experiment checkpoint/session/context logging.
- Generic event note/symptom/observation/common intake logging.
- Manual sample entry.
- High-value supplement/protocol typed creation or update paths.
- Command-schema regression coverage for the new agent-first surfaces.

Out of scope:
- Health Commons measurement-method command work owned by the active Worker D lane.
- Active hosted, assistant runtime, and commons command changes.
- Broad dependency updates or package topology changes.

## Constraints

- Follow incur's canonical contract: Zod-typed args/options/output for agent-facing commands; JSON input is an escape hatch, not the primary interface.
- Preserve `.env*`, credentials, local paths, and direct personal identifiers.
- Do not add `as any` or broad `as unknown as T` casts to silence TypeScript.
- Do not overwrite unrelated dirty work in the shared checkout.
- Batch implementation through at most five GPT-5.5 xhigh workers at once, with disjoint write scopes.

## Plan

1. Register this task in the coordination ledger.
2. Run five worker lanes for experiment, event, samples, supplement/protocol, and schema guard coverage.
3. Integrate returned changes, resolve conflicts, and regenerate incur artifacts if needed.
4. Run focused tests, typecheck, required completion audits, and package-shape checks as feasible.
5. Close the plan and commit only if safe in the dirty shared checkout.

## Verification

Expected minimum:
- Focused CLI tests covering changed command schemas and behavior.
- `pnpm typecheck`.
- Repo diff verification for touched paths or package-local equivalent.
- `pnpm --dir packages/cli verify:package-shape` if incur generated artifacts change.

Completed:
- Added typed incur command surfaces for experiment checkpoint/session/context logs, typed event note/symptom/observation/supplement-intake adds, typed `samples add`, typed `supplement save`, and typed `protocol save`.
- Preserved explicit JSON fallback commands as `event import-json`, `samples import-json`, `supplement import-json`, `protocol import-json`, and experiment `*-json` fallbacks.
- Removed legacy high-value `event upsert`, `supplement upsert`, and `protocol upsert` JSON blob commands from the agent-visible command tree and regenerated incur artifacts.
- Added schema/runtime proof covering typed command schemas, fallback separation, event typed writes, sample timestamps, supplement/protocol save, and explicit JSON import fallbacks.
- Required `coverage-write` and `task-finish-review` local subagent passes completed; the final review finding about legacy upsert visibility was fixed.

Final verification:
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-typed-agent-inputs-schema.test.ts packages/cli/test/cli-expansion-event-typed.test.ts packages/cli/test/supplement-protocol-typed-save.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts packages/cli/test/cli-expansion-samples-audit.test.ts packages/cli/test/stdin-input.test.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/cli/test/supplement-wearables-coverage.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/health-tail.test.ts` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/cli verify:package-shape` passed.
- `pnpm typecheck` passed.
- `git diff --check -- <task touched paths>` passed.
- `bash scripts/workspace-verify.sh test:diff <task touched paths>` passed CLI targeted verification and affected package typechecks through `packages/core` tests, then failed in unrelated `packages/device-syncd` test `sqlite store persists the webhook trace claim lifecycle` with expected `processed` but actual `claimed`.

Close note:
- No scoped commit was created because this shared checkout has overlapping active edits in the same generated/manifest/contract files; staging whole files would include other lanes' work.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
