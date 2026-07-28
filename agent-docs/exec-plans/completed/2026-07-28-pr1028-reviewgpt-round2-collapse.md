# PR 1028 ReviewGPT round-two simplification

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Resolve the accepted final ReviewGPT round-two finding on draft PR 1028 by
  deleting the unevidenced plaintext connected-app drain state.
- Preserve legacy plaintext approvals while requiring encrypted presentation
  for every connected-app approval from its first release.

## Proven basis

- The pre-PR Web producer writes only legacy `vault-file-send:` approvals.
- The connected-app approval producer and its encrypted storage are introduced
  together in this unmerged PR.
- No deployed producer therefore needs a plaintext `connected-app:` transition
  window or destructive postdeploy cleanup.

## Scope and invariants

- Fold the final encrypted-only connected-app check into the predeploy
  migration.
- Delete the connected-app postdeploy contract migration and drain prose.
- Keep the legacy non-connected plaintext row shape unchanged.
- Prove against a pre-PR table shape that legacy plaintext succeeds,
  connected-app plaintext fails, and connected-app ciphertext succeeds.
- Do not change the exact approval identity, consume boundary, provider
  execution, or member-bound encryption behavior.

## Tasks

1. [x] Collapse the migration to one final predeploy constraint and delete the
   postdeploy cleanup migration.
2. [x] Add static and real-PostgreSQL regression proof for the final row modes.
3. [x] Update the current rollout documentation. Update the draft PR
   description after the exact remediation head is pushed.
4. [x] Run focused checks, canonical verification, and parent review. Run CI
   and the next exact-head ReviewGPT remediation round after the push.
5. [x] Close this plan with a scoped commit and push the draft PR.

## Verification

- PASS: Prisma validation, Web typecheck, static migration tests, and the real
  PostgreSQL migration proof.
- PASS: action-approval database tests and production migration inventory and
  guard tests.
- PASS:
  `pnpm test:diff packages/hosted-execution packages/assistant-engine apps/web`
- PASS: `pnpm verify:acceptance`
  - An earlier operator-interrupted attempt left an ignored partial
    `.next-smoke` artifact. The exact generated directory was removed with the
    repository cleanup script before this clean rerun.
- Parent final review found no remaining accepted issue in the remediation
  delta.
- Pending after push: final ReviewGPT remediation delta review and PR CI on the
  exact head.
Completed: 2026-07-28
