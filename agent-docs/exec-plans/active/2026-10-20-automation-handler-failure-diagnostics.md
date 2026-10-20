# Private automation handler failure diagnostics

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Distinguish parsed automation actions and three core-owned error codes at the
existing caught handler failure. Preserve every RPC, effect, category and retry
decision. Implementation is against supplied base
`ccb8244979ff77633e3d45d85167e48b9ec7a72a`; no production evidence is embedded.

## Owner, evidence and invariant

The parsed dynamic request reaches `executeAutomationDynamicTool`; its generic
catch currently reduces distinct core errors to `handler_exception / unknown`.
`createHostedAssistantAutomationTool` calls core `patchAutomation` and
`reconcileAutomationSupportSeries`, which own the selected codes. This proves a
diagnostic gap, not a behavioral cause or a need to change model instructions.

Derive two optional scalars at that return, using the existing device/vault-file
diagnostic pattern. `completeDynamicToolFailureDiagnostics` already carries them
to private issue details; `assistant-codex` still sends only `result.rpcResult`.
No new state owner, dependency, schema, event, I/O, timer or retry is needed.

## Decisions and protected boundaries

- `automationAction` comes from the parsed five-action union, including
  `inspect_models`; the latter still calls the existing `inspect` port.
- Admit only `VAULT_AUTOMATION_EMPTY_PATCH`, `VAULT_AUTOMATION_MISSING` and
  `VAULT_AUTOMATION_RECONCILIATION_LIMIT_EXCEEDED`. They remain `unknown` in the
  existing classifier. Generic schema/storage and other codes are not added.
- Read an own data code only, with proxy rejection before descriptors; never
  execute an accessor or coerce/follow private payloads. Existing missing/conflict
  predicates and classifier reads remain unchanged. Tests distinguish those
  legacy reads from the new observer's zero getter/trap evaluation.
- Leave quiet missing inspections, conflict recovery, invalid input, unavailable
  ports, explicit result-format rejections and successes unannotated. Preserve
  abort propagation and existing call counts; omit an abort snapshot.
- Keep shell attribution opaque for compound commands and arbitrary shell JSON.
  Synthetic probes establish contract boundaries, not production intent, ordering,
  target recovery, cancellation, full-population rates or release attribution.
- Existing readers accept both optional-field shapes; no migration, deployment
  ordering change or historical backfill. No changelog or real-model journey:
  the patch changes only private failure evidence, with no prompt, tool schema,
  provider-visible input, control flow or member-visible output change.

## Tasks

1. [x] Trace the parsed action, hosted adapter, core error owners, catch, private
   completion/reporter/parser and unchanged RPC serialization.
2. [x] Add the finite optional observer only to the generic automation catch.
3. [x] Add real-dynamic-contract regressions for all actions/codes, privacy,
   hostile objects, omission, effect counts, cancellation and RPC parity.
   Extend only the existing opaque-shell test into the missing exit-code matrix.
4. [x] Extend `docs/hosted-runtime-log-database.md` with field meaning, omission,
   compatibility and a capped fixed-UTC natural-traffic query. Preserve its
   existing index mapping.
5. [x] Inspect the complete authored diff and run dependency-free syntax checks.
6. [ ] Investigator: run the focused regression first, then affected package
   tests/typecheck and repository guards below; retain the independent ReviewGPT
   gate and all git, PR, release and monitoring ownership separately.

## Verification and handoff

Run the new regression first:

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-failure-diagnostics.test.ts
```

Then the affected existing boundaries and typecheck:

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-tool-failure-diagnostics.test.ts test/assistant-dynamic-tool-failure-boundary.test.ts test/assistant-expanded-wearable-awareness.test.ts test/assistant-automation-inspection.test.ts
pnpm --dir packages/assistant-engine typecheck
pnpm complexity:diff
pnpm docs:drift
```

Reuse the existing CLI subprocess coverage in
`packages/cli/test/cli-timing-subprocess.test.ts` for missing measurement metric,
knowledge missing body/unknown option and nearby successful automation list.
`packages/runtime-state/test/cli-timing.test.ts` already covers finite validation
detail. Existing assistant diagnostics cover `not_found` and knowledge
`arguments/custom`; expanded-wearable-awareness tests use the production prompt
builder and adjacent skills. No duplicate probes or performance-lane edits.

Local `node --check` passed for both changed source modules and both test files.
The new regression, package typecheck and complexity guard were attempted but
blocked before execution: the archive has no installed dependencies, and the
available pnpm is 11.25.0 versus the pinned 10.33.0. No package-test, typecheck or
complexity-guard pass is claimed. Source review confirms the existing catch adds
no branches; only the small private observer/reader are new.

`bash scripts/frog list` was attempted but Frog is not installed in this source
archive. No new Frog entry: this setup limitation is environment-specific, and
the runtime observation is not developer friction. The documented plan helper
created this plan after restoring its omitted empty parent directory. Keep it
active for the requested investigator handoff; no commit or production call.
