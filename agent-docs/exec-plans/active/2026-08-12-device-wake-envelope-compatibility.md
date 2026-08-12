# device-wake-envelope-compatibility

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Restore periodic wearable recovery for legacy pending connections without
  weakening mailbox deduplication or changing normal foreground processing.

## Success criteria

- Scheduled reconcile wakes use a revision distinct from legacy unhashed wake
  envelopes, while dirty-transition wake identities remain unchanged.
- Focused wake and sweep tests prove the exact identity and retry behavior.
- The owning orchestration contract explains when the event revision must move.
- Exact-head CI and both required ReviewGPT stages pass before merge.
- Production recovery is resumed only after the exact deployed revision is
  verified, and bounded logs show successful sweeps without dedupe conflicts.

## Scope

- In scope: scheduled device-sync wake identity, focused tests, the owning
  orchestration contract, and the existing wearable-recovery changelog item.
- Out of scope: mailbox schema changes, data rewrites, new retry owners,
  Temporal Workflow changes, and changes to foreground or dirty-transition
  device-sync processing.

## Constraints

- Technical constraints: preserve fail-closed payload-hash deduplication and
  keep the event revision as the only compatibility boundary.
- Product/process constraints: keep health data and direct member identifiers
  out of logs and artifacts; do not resume the paused recovery schedule until
  the public deployment is proven live.

## Risks and mitigations

1. Risk: changing the shared wake revision creates duplicate dirty-transition
   work.
   Mitigation: split the scheduled revision from the unchanged dirty revision.
2. Risk: a new identity admits more than one logical scheduled wake.
   Mitigation: retain connection, connected-at, and next-reconcile-at in the
   identity and keep the existing mailbox hash, signal, and wake-bucket bounds.

## Tasks

1. Add the scheduled-only event revision and direct regression coverage.
2. Document the compatibility boundary and update existing changelog
   provenance after the PR number is allocated.
3. Run focused tests, Web typecheck, and secret-safe diff inspection.
4. Push the exact candidate, start CI and both ReviewGPT stages concurrently,
   and resolve any accepted findings.
5. Merge, deploy the exact revision, resume the periodic recovery schedule,
   and verify successful bounded recovery.

## Decisions

- Use a scheduled-wake event revision instead of a database mutation or a
  dedupe exception. Existing legacy rows remain valid historical evidence, and
  the strict mailbox comparison remains intact.
- Keep the dirty-transition event revision at `v1`; its monotonic dirty
  revision does not reuse the stuck scheduled-reconcile identity.

## Verification

- Focused Vitest for scheduled wake creation and the due-reconcile sweeper.
- Web TypeScript check.
- Repository diff/identifier checks and required exact-head GitHub checks.
- Post-deploy exact-revision proof plus bounded recovery-sweep logs.
