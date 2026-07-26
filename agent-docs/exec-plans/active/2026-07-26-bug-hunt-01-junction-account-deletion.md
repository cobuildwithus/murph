# Close Junction account-deletion authorization race

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Ensure hosted account deletion cannot report success while an already-issued
  or concurrently-starting Junction Link can still authorize a wearable source
  for the deleted member.

## Success criteria

- Account deletion removes the upstream Junction user, invalidating the
  user-level provider connection surface instead of only deregistering sources
  visible at one point in time.
- A Junction Link start racing member suspension either becomes visible to the
  deletion workflow before upstream cleanup or aborts and removes the upstream
  user without returning an authorization URL.
- Ordinary device disconnect keeps its existing per-source deregistration
  behavior.
- Focused tests prove the deletion endpoint and both relevant race orderings.
- Required repository verification, preliminary specialist review, final
  ReviewGPT, and PR checks pass on the exact pushed head.

## Scope

- In scope: Junction provider/client deletion capability, hosted device-connect
  start/deletion coordination, account-deletion provider cleanup, focused
  device-sync and hosted privacy tests, and current owner documentation.
- Out of scope: queues, reconciliation services, new persisted tables, changes
  to ordinary disconnect semantics, other providers, and the separate hosted
  group-affirmation replay finding.

## Constraints

- Technical constraints: keep the provider boundary narrow; preserve the
  hosted-member suspension fence and fail-closed provider-config deletion;
  never persist or log provider credentials or private identifiers.
- Product/process constraints: use the isolated worktree and PR lane, keep the
  PR unmerged, and complete preliminary plus final ReviewGPT gates.

## Risks and mitigations

1. Risk: deleting a Junction user during an ordinary disconnect would erase
   other wearable sources unexpectedly.
   Mitigation: retain `revokeAccess` for disconnect and expose deletion only
   through the account-data path.
2. Risk: deleting only currently persisted Junction connections leaves an
   in-flight provider user outside the deletion snapshot.
   Mitigation: prove and test the connect-start/suspension ordering rather than
   relying on a second best-effort enumeration.
3. Risk: broad generic lifecycle machinery obscures the privacy invariant.
   Mitigation: prefer an existing transaction/owner fence plus one optional
   provider-owned deletion capability.

## Tasks

1. Validate the ReviewGPT finding against the current provider, hosted store,
   and account-deletion paths.
2. Ask the same ReviewGPT thread for a narrow patch artifact and inspect it as
   untrusted implementation intent.
3. Implement the smallest race-closing correction and focused regression tests.
4. Update current owner documentation and run focused plus canonical
   verification.
5. Run the preliminary specialist pass, parent review, final ReviewGPT loop,
   and required PR checks without merging.

## Decisions

- Keep the unrelated group-affirmation replay finding for a separate bug-hunt
  batch because its durable idempotency ownership does not overlap this fix.
- The correction must delete the Junction user on account deletion; listing and
  deregistering currently connected sources cannot invalidate a Link token
  issued before deletion.

## Verification

- Passed:
  - `pnpm --dir packages/device-syncd test` (44 files, 867 tests).
  - `pnpm --dir packages/device-syncd typecheck`.
  - `pnpm --dir apps/web typecheck`.
  - Focused hosted account-deletion tests (59 tests; the opt-in PostgreSQL
    suite skipped without its environment flag).
  - Focused affected web lint.
  - The opt-in real-PostgreSQL connection-start/account-deletion proof against
    the isolated worktree database (2 tests covering both lock orderings).
  - The isolated CLI tests that timed out only inside the broad local fanout,
    including the documented non-persistent harness escape hatch.
- Canonical `pnpm test:diff <changed paths...>` cleared global guards, all
  affected typechecks, and the large Assistant Engine, Assistant Runtime,
  Assistant CLI, and Assistantd suites. Its broad CLI fanout was interrupted
  after unrelated untouched tests hit 60-second subprocess timeouts and then
  stopped making progress. Each reported timeout passed immediately in focused
  isolation; the changed device-sync and hosted privacy surfaces were already
  green.
- Still to run: preliminary `completion-specialists`, parent final review,
  final verification/PR CI, and final `pr-review`.
- Expected outcomes: all focused and canonical checks pass; both ReviewGPT
  gates return zero accepted findings on the exact pushed head.
