# Pin configured Whisper registry to discovered toolchain snapshot

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Make `createConfiguredParserRegistry(...)` honor the exact Whisper toolchain state already discovered by doctor/toolchain discovery so parser selection cannot drift back to different env/PATH values or treat a missing model as available.

## Success criteria

- `createConfiguredParserRegistry(...)` builds the Whisper provider from one resolved snapshot instead of re-discovering command/model values independently.
- When doctor/discovery marks Whisper unavailable because the model file is missing or the command cannot be resolved, the configured registry also reports Whisper unavailable.
- The configured registry uses the discovered absolute command path rather than re-resolving `PATH` or env overrides at runtime.
- Focused parser tests cover the unavailable/missing-model path and the pinned-command snapshot behavior.
- Required verification and required audit passes complete, or any unrelated blocker is recorded precisely.

## Scope

- In scope:
- `packages/parsers/src/toolchain/discover.ts`
- `packages/parsers/src/adapters/whisper-cpp.ts`
- directly coupled tests under `packages/parsers/test/parsers.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-parser-whisper-toolchain-snapshot.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader parser registry refactors beyond the Whisper discovery/provider seam
- changes to non-Whisper parser providers
- README wording unless the implementation change reveals a doc mismatch that still needs correction

## Constraints

- Technical constraints:
- Preserve current parser behavior outside the Whisper availability/command-resolution seam.
- Keep the fix local to `packages/parsers`; do not widen into parser publish/runtime/store code.
- Product/process constraints:
- Follow the standard repo-change workflow for package code: scoped coverage-bearing verification, required `coverage-write`, and required `task-finish-review`.
- Do not expose personal identifiers in plan text, diffs, tests, logs, or commit metadata.

## Risks and mitigations

1. Risk: tightening the provider around a resolved snapshot could break direct provider consumers that still rely on discovery-by-env behavior.
   Mitigation: preserve existing exported provider behavior for direct callers and add a snapshot-backed path specifically for configured-registry construction.
2. Risk: a partial snapshot contract could still allow command or model drift between discovery and runtime.
   Mitigation: thread explicit absolute command/model values and availability through one shared resolved tool shape used by both doctor output and configured-registry assembly.

## Tasks

1. Register this parser toolchain lane in the coordination ledger with the exact active plan path.
2. Inspect `discover.ts` and `whisper-cpp.ts` to identify the minimal seam for building providers from resolved discovery state.
3. Implement the snapshot-pinned Whisper registry behavior without widening beyond the parser toolchain/adaptor seam.
4. Add focused parser regressions for missing-model unavailability and pinned absolute-command behavior.
5. Run required verification and completion audits, then land the narrow fix if the shared tree still permits a scoped commit.

## Decisions

- Keep direct `createWhisperCppProvider(...)` discovery behavior available for external callers, but add a resolved-snapshot path so `createConfiguredParserRegistry(...)` does not rediscover Whisper from raw config/env state.
- The shared worktree already contains adjacent parser toolchain/worker fixes in `packages/parsers`; land the combined parser package diff together rather than trying to split overlapping file edits into an unsafe partial commit.

## Verification

- Commands to run:
- `pnpm --dir packages/parsers typecheck` ✅
- `pnpm --dir packages/parsers test:coverage` ✅
- `pnpm test:smoke` ✅
- `pnpm typecheck` ⚠️ unrelated pre-existing `packages/inbox-services` / `packages/assistant-cli` type failures
- `bash scripts/workspace-verify.sh test:diff packages/parsers/src/toolchain/discover.ts packages/parsers/src/adapters/whisper-cpp.ts packages/parsers/test/parsers.test.ts` ⚠️ unrelated pre-existing `packages/inbox-services` / `packages/assistant-cli` type failures
- Expected outcomes:
- parser package tests prove the configured registry mirrors doctor/discovery availability and uses the discovered absolute command path
- required audit passes complete, or any unrelated pre-existing blocker is captured exactly
- Required audit passes:
  - `coverage-write` on `gpt-5.4-mini` completed with no additional edits needed
  - `task-finish-review` completed with no findings; only residual note was an env-model drift proof gap, which is now covered by the added `WHISPER_MODEL_PATH` snapshot regression
Completed: 2026-04-24
