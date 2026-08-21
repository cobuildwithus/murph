# Recover Junction setup when the browser callback is lost

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Ensure an authenticated, source-attributed Junction webhook can recover an
  exact pending Murph source setup after the initiating browser callback is
  lost, but only after live Junction connection proof.

## Success criteria

- The signed webhook resolves the exact Junction account and source prepared by
  Murph's pending start.
- A live Junction provider-list read runs outside database ownership and only
  an explicit connected result authorizes setup completion.
- Final admission atomically commits callback-equivalent source establishment,
  initial work, mailbox handoff, dirty state, receipt, and webhook trace under
  the existing health-data admission lock.
- Inactive, ambiguous, stale, superseded, disconnected, and consent-revoked
  states remain fail-closed and retry or settle according to their existing
  owner contracts.
- Callback/webhook races stay idempotent and established sources avoid an
  unnecessary provider read.
- Focused tests and typechecks pass on the final file state.

## Scope

- In scope: audit the current hosted Junction setup-recovery owner, implement
  only any proven gap, and add the smallest production-composed regression
  proof needed for callback-loss recovery.
- Out of scope: a second connection state machine, schema changes, a new queue,
  accepting a webhook as connection proof, or changing Junction Link itself.

## Product UX

- Effort: Patch.
- Affected people: a member whose successful provider connection loses the Web
  callback; a member whose provider is not actually active; and a member whose
  callback races a webhook, reconnect, disconnect, or consent change.
- Intended result: the first member completes setup automatically from the
  verified webhook plus live provider proof; every other member keeps the
  current fail-closed behavior without duplicate setup or work.
- Walkthrough evidence: production-composed signed-webhook tests covering the
  active success path and the existing negative/race paths.

## Constraints

- Reuse the existing signed-ingress, provider-list, health-data lock, source,
  mailbox, dirty-work, and trace owners.
- Keep provider/network work outside all database transactions.
- Preserve current Queue/Web deployment compatibility and rollback order.
- Treat the already-merged recovery in PR #2088 as the baseline; do not
  duplicate behavior that current main already owns.

## Risks and mitigations

1. Risk: treating any signed webhook as proof of an active provider.
   Mitigation: require the existing live exact-source Junction provider-list
   result and final locked authority revalidation.
2. Risk: a late webhook resurrects superseded or withdrawn source authority.
   Mitigation: retain exact account/source epochs, setup expiry, disconnect
   fences, provider-app binding, and consent rechecks at final admission.
3. Risk: callback and webhook both publish initial work.
   Mitigation: use the existing atomic source-admission owner and deterministic
   work identities; prove the race remains idempotent.

## Steps

1. Completed: inspected current main and asked ReviewGPT to implement only a
   demonstrated gap in the requested invariant.
2. Completed: verified Junction's official provider-list and connection-event
   contracts, inspected the returned patch, and applied its exact code/test
   diff deliberately.
3. Completed: ran the focused provider and production-composed PostgreSQL
   suites plus both owning package typechecks.
4. In progress: open the PR and complete the required specialist, final
   ReviewGPT, exact-head CI, and deployment handoff gates.

## Decisions

- Current main already owned the callback-loss recovery path from PR #2088:
  the signed webhook is a trigger, provider I/O runs outside the transaction,
  and final source/work/mailbox/dirty/trace admission is atomic under the
  health-data lock.
- Accepted ReviewGPT's demonstrated authority gap: the live provider-list
  helper reused a broader projection mapper that treated `active`, `available`,
  and `ok` as connected and accepted a matching `connected` row even alongside
  a matching error row. Junction documents outer connection status separately
  from nested resource availability, and the installed SDK describes that
  outer status as connected or error.
- Tightened only this proof boundary. Every exact-source provider row must now
  carry the normalized literal status `connected`; aliases, unknown values, and
  mixed statuses remain non-authoritative and retry under existing owners.
- Added no schema, queue, lifecycle, state owner, or callback requirement.

## Verification

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-provider.test.ts`
  passed 322 tests.
- The opt-in real-PostgreSQL prepared-webhook authority suite passed 17 tests,
  including production `startConnection`, an unconsumed callback state, signed
  `provider.connection.created`, one live provider-list proof, atomic setup and
  source work, mandatory mailbox handoff, and replay without a second read.
- `pnpm --dir packages/device-syncd typecheck` passed.
- `DATABASE_URL=<LOCAL_POSTGRES_URL> pnpm --dir apps/web typecheck` passed.
- Web's changed test file passed focused ESLint. The device-sync package has no
  package-owned ESLint binary; its focused tests and typecheck are green.
