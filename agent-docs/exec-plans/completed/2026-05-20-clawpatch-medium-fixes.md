# Clawpatch Medium Fixes

## Goal

Resolve the six selected medium Clawpatch findings with minimal, app-owned changes:

- verify whether generated workflow step path artifacts are a real exposure path before changing build flow
- align hosted email `selfAddress` limits across producer and parser
- make phone sync enqueue decisions use current transactional state
- avoid connected-success messaging on device-sync error returns
- show denied usage-gate notices on home when a user notice exists
- reject missing or blank hosted invite abort `sendAttemptId`

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Do not patch third-party libraries or add dependency overrides.
- Prefer existing seams, shared constants, and route-local validation over new architecture.
- Do not write local paths, local usernames, secrets, raw payloads, or personal identifiers into code, tests, docs, logs, or generated artifacts.
- Treat the generated workflow finding as unconfirmed until the actual runtime/deploy exposure path is proven.

## Plan

1. Inspect the six findings and touched code/tests, including current dirty overlap.
2. Verify the workflow artifact exposure path and either fix a real app-owned leak or document/revalidate a non-exposed generated-artifact finding.
3. Implement focused fixes for confirmed route/contract bugs.
4. Add or update focused tests for each confirmed behavior.
5. Run scoped verification, Clawpatch revalidation, required repo audits, and close with the scoped commit path if the worktree allows it.

## Progress

- Registered plan and ledger row.
- Confirmed the Workflow path finding is generated source output, not request-time route behavior. Added an app-owned post-build cleanup path instead of patching the Workflow package or mutating artifacts before the loader uses them.
- Implemented focused fixes for hosted email self-address bounds, phone/Telegram transactional channel snapshots, device-sync error return copy/actions, denied gate notices, and invite abort request validation.
- Ran focused route/package/script tests and typechecks. Clawpatch revalidated all six selected findings as fixed.
- Frontend audit found a low-severity banner label mismatch; changed the usage gate banner region label to a generic account notice.
- Security/privacy audit found the Workflow cleanup missed `.next` cache/source-map artifacts; expanded cleanup to remove Workflow cache/socket files and marker-bearing server sourcemaps. Follow-up security review reported no findings.
- Repo `test:diff` passed repo tools and several package lanes, then stopped in `packages/cli` tests on an unrelated dirty parse error in `packages/device-syncd/src/providers/oura.ts`.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
