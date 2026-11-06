# Vault-file failure telemetry

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

Preserve the finite identity of source-owned vault-file preparation rejections
in existing private failure diagnostics without changing tool behavior. Complete
the bounded implementation and verification, with explicit release and monitoring
handoff to the local completion owner.

## Success criteria

- The existing send-vault-file catch retains an optional allowlisted
  `vaultFileErrorCode` through dynamic-tool completion, issue sanitization and
  record parsing, with no telemetry in the RPC envelope.
- Unknown, unallowlisted, inherited, accessor and proxy code evidence is omitted;
  the new observer invokes no getters or proxy traps and retains no private text.
- Existing failure stage, reason and category, RPC text, final actions, approval
  handling and call counts remain unchanged, including already-active success.
- Focused synthetic regressions, assistant-engine typecheck and the existing
  complexity ratchet pass on the corrected candidate.
- The local completion owner receives the independent review, CI, merge, release
  and private-safe monitoring gates, with their pending status recorded honestly.

## Scope

- In scope: the caught-error annotation, its diagnostic owner, focused tests,
  the existing telemetry contract, complexity repair and this validation handoff.
- Out of scope: preventive behavior or recovery changes, global reclassification,
  HTTP details, prompts, tool schemas, providers, new telemetry stores or streams,
  new dependencies, version changes and unrelated cleanup.

## Constraints

- Use the existing small exact source-owned code allowlist and only own data
  descriptors; reject proxies before inspection. The new detail reader must not
  follow causes, context or prototypes, invoke accessors, or retain paths, refs,
  identifiers, arguments, results, stacks or payloads.
- Preserve the real source-owned already-active success and its unannotated
  result. Treat proxy errors as opaque before the existing generic classifier
  at this catch.
- Use synthetic state and fake ports only. No provider calls, production
  destinations or member activity are part of implementation verification; this
  telemetry-only correction needs no new live model journey.
- Preserve the complexity guard and baseline. Repository authoring remains with
  the implementation owner; validation, commit, PR and release remain with the
  local completion owner under the current workflow documents.

## Risks and mitigations

1. Private error material could enter telemetry or RPC output. Mitigate with
   exact scalar admission and forbidden-content checks through completion,
   persistence sanitization, record parsing and RPC output.
2. Diagnostic inspection could change a successful or failed tool outcome.
   Mitigate with approved, pending, already-active, unknown and hostile-error
   regressions that also assert final actions and effect counts.
3. Initial validation could become stale after complexity repair. Rerun the
   affected checks on the corrected candidate before independent review and CI.

## Tasks

- [x] Implement the private annotation, focused regressions and durable contract.
- [x] Receive local validation and the catch-only reversion proof for the initial
  candidate; identify the introduced complexity regression.
- [x] Extract the complete safe already-active error predicate into the existing
  diagnostic owner, leaving workflow decisions and proxy normalization in the catch.
- [x] Local completion owner: rerun focused tests, typecheck and complexity on the
  corrected candidate; confirm the introduced complexity debt is removed and
  documentation drift and diff whitespace checks pass.
- [x] Complete the bounded telemetry implementation and local verification;
  record the pending operational gates in the handoff below.

## Decisions

- Extend the existing private diagnostic path at the earliest caught-error
  boundary; do not infer the cause of historical failures or change recovery.
- Extract a named predicate for the existing typed already-active condition.
  It rejects proxies itself and checks an own data code, so the handler no longer
  owns descriptor mechanics. No unrelated logic or baseline moves are needed.
- Missing files retain `not_found`; unknown failures remain `unknown` with
  `vaultFileErrorCode` absent. Successes remain unannotated.

## Verification

The local completion owner reported these initial-candidate results:

- All 55 `assistant-vault-file-send` tests passed.
- All 213 neighboring `assistant-tool-failure-diagnostics` and
  `assistant-dynamic-tool-failure-boundary` tests passed.
- Assistant-engine typecheck passed.
- Reverting only the dynamic-tools catch made exactly the two new real-owner
  attribution cases fail. Restoring the authored catch passed all three cases,
  including the existing missing-file neighbor, proving the diagnostic boundary.
- `pnpm complexity:diff` failed: dynamic-tools debt increased from 429 to 431;
  `executeSendVaultFileDynamicTool` increased from 20 to 22, while the file maximum
  remained 136. The diagnostics owner passed.

The local completion owner independently verified the corrected candidate:

- All 268 focused tests passed: 55 vault-file tests and 213 neighboring
  diagnostics/boundary tests.
- Assistant-engine typecheck, `docs:drift` and the diff whitespace check passed.
- `pnpm complexity:diff` passed: dynamic-tools debt 429 → 429, maximum 136
  unchanged; diagnostics debt 0 → 0, maximum 14 unchanged.
  `executeSendVaultFileDynamicTool` is now 19, below the hotspot
  threshold. The introduced complexity regression is resolved.

The focused verification commands are:

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-vault-file-send.test.ts test/assistant-tool-failure-diagnostics.test.ts test/assistant-dynamic-tool-failure-boundary.test.ts
pnpm --filter @murphai/assistant-engine typecheck
pnpm complexity:diff
```

Bounded telemetry implementation, corrected-candidate local verification and
this handoff are complete. The local completion owner will invoke
`scripts/finish-task` to archive this active plan and commit the exact scoped
candidate with the approved local Git identity. The index already targets the
completed plan location that the helper will create in the same commit.

### Operational handoff (pending)

Independent ReviewGPT and required exact-head CI remain pending and must run
concurrently on the intended pushed candidate under the current review loop.
Merge, protected deployment and the four-hour natural-traffic observation also
remain pending with the local completion owner. Archiving this bounded plan
does not complete those gates; their execution follows the current owner docs.
No deployment or post-release observation is claimed here.

### Private monitoring handoff

After an authorized, verified release, the local release owner must confirm
producer/reader compatibility and deployed coverage, including warm runners,
then observe one fixed four-hour natural-traffic window. Use bounded typed reads
of existing private send-vault-file classification metadata, grouped only by
the finite code and existing failure stage, reason and category. Keep native
completion projections and their denominators separate from overlapping tool
classifications; do not induce calls or failures.

Treat missing or unknown codes as unresolved and an empty window as inconclusive.
Keep exact deployment/window identity and operational evidence in the private
handoff; tracked updates should contain only implementation and gate status.
Do not fetch or retain member material, original arguments, refs, paths or error
prose. Monitoring does not authorize behavioral fixes, retries or rollback.
Merge, protected deployment and this observation remain pending with the local
completion owner, including any gates still outstanding when the authored plan
is archived.
Completed: 2026-10-18
