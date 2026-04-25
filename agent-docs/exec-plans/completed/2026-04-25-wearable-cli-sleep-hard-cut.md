# Hard-cut wearable CLI sleep semantics and output shape

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Make the wearable CLI hard-cut to accurate, assistant-safe sleep semantics and a cleaner operator surface:
  `wearables day <date>` should work, `totalSleepMinutes` must not mean full sleep-window duration when asleep-stage data is available, default wearable JSON should avoid absolute vault paths, and broken-pipe output should not print Node stack traces.

## Success criteria

- `vault-cli wearables day 2026-04-25 --format json` works through a real positional date argument, and schema/generated command metadata reflects that shape.
- WHOOP-like sleep with a 444-minute window and awake/light/deep/REM stages reports `timeInBedMinutes = 444` and `totalSleepMinutes = deep + light + rem`, not 444.
- Direct `totalSleepMinutes` observations still win over derived stage totals.
- Wearable sleep summaries expose the selected provider at the top level instead of `provider: null`.
- Default wearable result envelopes omit absolute local vault paths and raw provenance identifiers.
- Piped CLI output exits cleanly on broken pipes without a stack trace.
- Focused CLI/query tests and direct local CLI checks cover the changed behavior.

## Scope

- In scope:
- `packages/query` wearable sleep summary semantics and focused tests.
- `packages/cli` wearable command args/output shaping, generated command metadata, and focused tests.
- Minimal CLI process error handling for EPIPE.
- Out of scope:
- Live WHOOP provider API calls or device-sync OAuth/runtime changes.
- New persisted state or canonical vault schema changes.
- Hosted web/dashboard UI changes.

## Constraints

- Technical constraints:
- Keep the CLI command tree incur-native; do not fake positional support through argv rewrites.
- Preserve direct metric provenance when a provider supplies a true `totalSleepMinutes`.
- Do not add dependencies.
- Product/process constraints:
- Treat wearable data as sensitive health data; avoid adding local paths, raw provider payloads, or personal identifiers to tests/docs/output.
- Preserve unrelated dirty work and active ledger rows.

## Risks and mitigations

1. Risk: Derived total sleep could conflict with a provider's direct total-sleep metric.
   Mitigation: Use derived asleep stages only when the direct metric is missing.
2. Risk: Compact/default output changes could remove debugging evidence agents still need.
   Mitigation: Keep semantic confidence, provider, source-family, source-kind, and notes while stripping local paths, record ids, candidates, and external provider refs from public wearable envelopes.
3. Risk: Command-shape changes can leave generated metadata stale.
   Mitigation: Regenerate or directly update generated command metadata and cover schema/help behavior in tests.

## Tasks

1. Inspect the current wearable CLI/query/test surfaces and active dirty work.
2. Implement derived asleep-stage `totalSleepMinutes`, selected sleep provider, and safer notes.
3. Implement positional `wearables day <date>`, default vault-path omission, and EPIPE handling.
4. Update focused tests and generated command metadata.
5. Run focused verification, direct CLI scenario checks, required audit passes, and scoped commit workflow.

## Decisions

- Use `deepMinutes + lightMinutes + remMinutes` as the derived asleep total when no direct `totalSleepMinutes` candidate exists and all three asleep-stage metrics are present.
- Continue using selected sleep-window duration for `timeInBedMinutes` when no direct time-in-bed metric exists.
- Omit the top-level `vault` path from wearable command/service results.
- Strip raw wearable provenance keys (`candidates`, local paths, record ids, candidate ids, external refs) from public wearable service envelopes.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/query/src/wearables.ts packages/query/src/wearables/summaries.ts packages/query/test/wearables-normalized-surfaces.test.ts packages/cli/src/commands/wearables.ts packages/cli/src/bin.ts packages/cli/test/wearables-additive-commands.test.ts packages/cli/test/cli-entry.test.ts`
  - Focused Vitest commands as needed while iterating.
  - Direct local `vault-cli` checks against the connected wearable vault.
- Expected outcomes:
  - Required checks pass, or any failure is clearly unrelated to this diff and documented.

## Current verification notes

- Focused CLI/query/vault-usecases tests passed.
- Package typechecks for `packages/cli`, `packages/query`, and `packages/vault-usecases` passed.
- Direct local wearable checks verified positional day args, derived `totalSleepMinutes`, omitted `vault`, omitted raw provenance keys, and clean EPIPE behavior.
- `workspace-verify test:diff` reached the unrelated `apps/cloudflare` verification step and failed on a pre-existing TypeScript error outside this task scope.
Completed: 2026-04-25
