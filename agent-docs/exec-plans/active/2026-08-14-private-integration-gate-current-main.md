# Restore the private integration gate on current public main

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Restore production-shaped private integration proof for the already-reviewed
  Cloudflare deployment stack, without weakening production crypto, runtime,
  or queue invariants.

## Success criteria

- Deterministic test fixtures use the current production crypto contracts.
- Every group-email participant has a real hosted workspace before projection
  snapshots are seeded.
- Focused tests and typechecks pass for the changed surfaces.
- The exact pushed candidate receives the required specialist review and green
  CI before merge.
- The private integration workflow is rerun against a newly resolved public
  main SHA; remaining failures are diagnosed rather than bypassed.

## Scope

- In scope: stale public test fixtures proven by the private integration logs;
  focused regression verification; PR/review/merge follow-through; rerunning
  the private gate.
- Out of scope: weakening production validation, hiding runtime failures,
  multipart R2 upload, or modifying the separately owned shell-sandbox PR.

## Constraints

- Technical constraints: preserve exact KMS resource names and contact-key
  rotation rules; create participant workspaces through the normal activation
  owner; keep the patch test-only unless new evidence proves a runtime defect.
- Product/process constraints: keep unrelated worktrees and active PR ownership
  intact; use ReviewGPT and exact-head CI; do not merge the private queue PR
  while its required integration check is red.

## Risks and mitigations

1. Risk: a fixture-only correction masks a real production ordering defect.
   Mitigation: change only setup that directly contradicts current contracts,
   rerun the full private suite, and investigate every remaining failure from
   fresh exact-SHA logs.
2. Risk: current public main or the separately owned shell fix moves while the
   gate is being repaired.
   Mitigation: resolve and record a fresh public SHA for every full private run
   and preserve the separate PR owner until its review gates complete.

## Tasks

1. Correct exact KMS/signing and contact-keyring fixtures in PostgreSQL tests.
2. Activate both group-email participants before seeding group projections.
3. Run focused tests and typechecks, inspect the diff, and prepare the PR.
4. Complete specialist review, exact-head CI, and merge the fixture correction.
5. Rerun private integration against fresh public main and resolve or isolate
   any remaining production-shaped failures.

## Decisions

- Keep this first correction test-only: the failing evidence shows current
  production validators rejecting obsolete fixtures, and the missing group
  workspace is caused by setup activating only one of two participants.
- Do not duplicate the active shell-sandbox change in PR #1815.

## Verification

- `pnpm --filter @murphai/hosted-web typecheck` — passed.
- `pnpm --filter @murphai/cloudflare-runner typecheck` — passed.
- Focused participant-addition PostgreSQL proof — six unaffected cases passed;
  the two cases that had reached the stale MAC fixture passed after the final
  resource-name correction. One unrelated concurrency case exceeded its local
  60-second budget while the shared host was heavily CPU-bound; the same case
  completed in about two seconds in the source CI failure run.
- Focused member-lock PostgreSQL proof — the principal-recovery case passed with
  the real local KMS signer and verification keyring. The deletion case advanced
  through the formerly failing signing path and expired its 15-second Prisma
  transaction by 58 milliseconds during cleanup under the same local host load.
- Still required before merge: exact-head specialist review and GitHub CI.
- Still required after merge: a fresh private `Public Murph Integration` run.
