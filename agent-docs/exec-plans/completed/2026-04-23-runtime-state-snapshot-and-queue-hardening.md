# Harden hosted snapshot preserved-artifact filtering and portable queue envelopes

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make hosted bundle snapshotting fail closed for preserved artifact refs and align the portable pending usage/issue queues with the package's versioned JSON contract.

## Success criteria

- Preserved artifact refs are revalidated against the same root-specific include rules used for live files before they are appended to a hosted bundle.
- Unknown roots, non-portable paths, `.env` paths, and no-longer-present/deleted artifact refs cannot be resurrected through `preservedArtifacts`.
- Portable pending usage and issue queue entries persist with the existing `schema` + `schemaVersion` + `value` envelope helpers instead of ad-hoc JSON blobs.
- Queue scans skip malformed or forward-versioned files, report them through an explicit invalid-record callback, and continue exporting valid records.
- The fix stays scoped to `packages/runtime-state`, the directly coupled hosted runtime export path, and focused proof.

## Scope

- In scope:
  - `packages/runtime-state/src/{hosted-bundle-node,hosted-bundles,assistant-usage,assistant-runtime-issues}.ts`
  - directly coupled runtime-state tests for hosted bundles and assistant usage/issues
  - `packages/assistant-runtime/src/hosted-runtime/issues.ts`
  - directly coupled hosted-runtime usage/issues tests only if required for queue-export behavior
  - `agent-docs/exec-plans/active/{2026-04-23-runtime-state-snapshot-and-queue-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - broader hosted runner bundle lifecycle redesign
  - assistant provider/billing changes already in flight on `assistant-usage.ts`
  - migration tooling beyond read/write compatibility for the pending queue files

## Constraints

- Technical constraints:
  - Reuse the existing runtime-state portability policy and versioned JSON helpers instead of adding a second snapshot or queue policy path.
  - Preserve current queue file locations and deletion semantics so directly coupled hosted export code keeps working.
- Product/process constraints:
  - Keep the diff narrow to the runtime-state snapshot + portable queue seam.
  - Preserve unrelated dirty-tree edits, especially the in-progress `assistant-usage.ts` hardening already present in the branch.
  - Treat this as a high-risk persisted-state and trust-boundary change: run the required coverage-bearing verification plus `coverage-write` and `task-finish-review` audit passes before handoff.

## Risks and mitigations

1. Risk: revalidating preserved artifacts could accidentally drop still-live externally stored files that are needed for incremental bundle reuse.
   Mitigation: reuse the same root/path include policy as live scanning, keep duplicate suppression keyed by normalized `root:path`, and add direct tests for allowed preserved refs, deleted refs, and blocked refs.
2. Risk: switching queue files to versioned envelopes could break existing export/import paths or strand malformed legacy files.
   Mitigation: keep queue record parsing owned by the existing record parsers, wrap only the file format with the shared envelope helpers, and add invalid-record callback coverage so malformed/newer files stay pending without wedging valid exports.
3. Risk: overlapping dirty-tree edits in `assistant-usage.ts` could be clobbered by a narrow fix.
   Mitigation: edit additively on top of the current branch state and keep assistant-usage changes limited to queue-envelope persistence/readback behavior.

## Tasks

1. Register this work in the coordination ledger and keep the scope narrow to the runtime-state seam.
2. Patch hosted bundle snapshotting so preserved artifacts are revalidated per root/path policy and skipped when a live file/tombstone decision already owns that path.
3. Switch portable pending usage/issues persistence to versioned JSON envelopes and add invalid-record skipping/reporting for both queues.
4. Update directly coupled runtime-state and assistant-runtime tests for preserved-artifact filtering and queue-resilience behavior.
5. Run required verification, required audit passes, and create a scoped commit if exact staging is possible in the current dirty tree.

## Decisions

- Preserve-artifact materialization keys accept either `raw/...` or root-qualified `vault/raw/...` inputs, but only treat `root:path` as explicit root syntax when the root prefix is a known workspace root (`vault`, `operator-home`).
- Pending usage and runtime-issue queue readers now remain fail-closed by default; the hosted export call sites opt into `skipInvalidRecords: true` with warning/report callbacks so malformed or forward-versioned files stay pending without wedging valid exports.
- Assistant-runtime now normalizes root-qualified materialized artifact paths through a dedicated helper so comparisons against runtime-state bundle entries remain correct without widening runtime-state archive formats.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/runtime-state/src/hosted-bundles.ts packages/runtime-state/src/hosted-bundle-node.ts packages/runtime-state/src/assistant-usage.ts packages/runtime-state/src/assistant-runtime-issues.ts packages/runtime-state/test/hosted-bundle.test.ts packages/runtime-state/test/assistant-usage.test.ts packages/runtime-state/test/assistant-runtime-issues.test.ts packages/assistant-runtime/src/hosted-runtime/issues.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts packages/assistant-runtime/test/hosted-runtime-issues.test.ts`
  - `pnpm test:smoke`
  - `git diff --check`
  - required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
  - hosted snapshot tests fail closed on blocked or deleted preserved artifact refs
  - portable queue reads continue past malformed/newer files while leaving them pending
  - the touched runtime-state and assistant-runtime lanes stay green

## Outcome

- Hosted bundle snapshotting now rejects unknown preserved roots, revalidates preserved artifact refs through the workspace portability policy, and prevents deleted materialized artifacts from resurfacing through preserved refs, including filenames containing `:`.
- Pending assistant usage and runtime issue queue files now persist with the shared versioned JSON envelope, legacy raw records still parse, strict readers fail closed by default, and hosted export paths can skip/quarantine malformed or newer files explicitly.
- Assistant-runtime bridges its root-qualified artifact path inputs to runtime-state's `{ root, path }` archive representation without misclassifying colon-bearing filenames as `root:path` keys.

## Audits

- Required `coverage-write` audit completed. It added direct runtime-state proof that tolerant runtime-issue listing skips a forward-versioned pending file while still returning valid records.
- Required `task-finish-review` audit completed. It found and we fixed two issues: ambiguous `:` parsing in materialized artifact key normalization, and queue readers defaulting to tolerant mode instead of strict-by-default opt-in skipping.

## Commit note

- Planned scoped commit message: `Harden hosted snapshot preserved refs and portable queues`.
Completed: 2026-04-23
