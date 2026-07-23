# PR 840 ReviewGPT Round 9 Remediation

## Goal

Resolve the two accepted round-nine findings without adding Assistant Ask state
or coordination:

1. Preserve the pre-checkpoint joined-group admission restriction when the
   active-turn loop imports the system lane.
2. For a pass with fresh accepted input, order Ask completions against that
   bounded batch's oldest input occurrence rather than a possibly stale first
   entry in the pending-input index.

## Constraints

- Preserve automatic wake and natural private-Murph composition.
- Do not run, advance, or shorten the ordinary idle checkpoint.
- Keep consented-member Ask requests checkpoint-gated throughout the dirty
  pre-checkpoint pass.
- Add no queue, coordinator, scheduler, reconciliation owner, or persisted
  state.
- Keep pending-input index backfill and compaction off the foreground reply
  path.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- focused Assistant Runtime tests
- current Assistant Ask architecture and hosted-runtime protocol docs

## Verification Plan

- Prove an active-turn system import retains joined-group-only admission.
- Prove a complete index with a terminal stale first entry cannot displace the
  pass-owned fresh-input cutoff or mutate the index.
- Run focused owner tests, Assistant Runtime typecheck, canonical
  `pnpm test:diff`, documentation drift checks, full acceptance verification,
  exact-head CI, and ReviewGPT remediation rounds until zero findings.

## Round Nine Findings And Decisions

The exact-head review of `56083c2b4098ea19b48a49c3f787572ef952640c`
returned two review-induced findings. Both reproduce and are accepted:

1. The active-turn system importer reconstructs its import context without the
   pass-wide Assistant Ask target restriction. Propagate the existing context
   field into that import.
2. A complete pending-input index may still retain terminal stale entries until
   background compaction. For fresh turns, derive the ordering cutoff from the
   bounded accepted input batch already owned by the pass; reserve the existing
   index lookup for passes without fresh input.

## Evidence

- The focused workspace-entrypoint suite passed: 235 tests.
- The focused pending-input and assistant-phase suites passed: 259 tests.
- Assistant Runtime typecheck and documentation drift checks passed.
- Canonical diff verification passed, including the full Assistant Runtime and
  Cloudflare owner suites.
- Full acceptance verification passed, including package coverage, the
  production Web build, and Cloudflare verification.
- Final diff inspection and whitespace validation passed.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
