# PR 475 Ambiguous Receipt Checkpoint Reconciliation

## Goal

Make hosted canonical receipt publication converge when the workspace checkpoint commits but its acknowledgement is lost, without accepting unrelated workspace progress or weakening the active invocation fence.

## Constraints

- Keep the correction inside the existing canonical checkpoint CAS boundary; add no new persisted state, queue, or generic retry subsystem.
- Retry only the identical `canonical_runtime_commit` request and accept a version conflict only when the returned workspace is the exact requested successor.
- Preserve rollback for unmatched, rejected, or repeatedly ambiguous outcomes.
- Preserve unrelated working-tree changes and redact local identifiers from committed artifacts.

## Plan

1. Add a production-faithful regression for a remotely committed checkpoint whose first acknowledgement is lost.
2. Add one bounded identical-CAS retry and exact successor-state reconciliation in the Cloudflare workspace-port owner.
3. Document the ambiguous-acknowledgement contract and run focused plus owner verification.
4. Run required completion audits and close the scoped fix; the PR lane then continues with base integration and exact-head Mountain and Phlebas rounds.

## Verification

- Assistant-runtime focused receipt/checkpoint tests and typecheck
- Cloudflare hosted control tests and typecheck
- Core focused receipt tests and typecheck
- Repo diff verification required by the workflow router
- Required local audits and exact-head ReviewGPT rounds

## State

Complete. The identical CAS retry and exact successor reconciliation are implemented and documented. Cloudflare typecheck, all 115 workspace-port owner tests, the 1,709-test Cloudflare verification lane, `test:diff`, privacy scanning, security/privacy review, coverage-write review, and local deep review passed with no remaining medium-or-higher finding.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
