# Restore Starter allowance from Ops

Status: completed
Created: 2026-08-18
Updated: 2026-08-18

## Goal

Make `/ops/usage` restore an exhausted Starter member to one fresh $4.50
allowance while preserving immutable usage history, existing credit provenance,
and the paid-plan reset behavior.

Success means:

- an operator can identify an exhausted Starter row and confirm the distinct
  Starter reset action;
- the reset appends one auditable positive grant under the beneficiary lock,
  rather than rewriting an exhausted grant or only clearing a derived period;
- purchased and referral credits, prior grants and debits, billing state,
  immutable usage, delivery history, and historical periods remain unchanged;
- stale table state, concurrent credit changes, and in-flight notice dispatches
  continue to fail closed; and
- focused tests, typechecks, rendered Product UX proof, and exact-head CI pass;
  any explicit user waiver of a review or platform-specific gate is recorded.

## Evidence

- Starter access is a non-expiring, credit-backed lifetime allowance with a
  zero included-period base. Once its ledger balance reaches zero, clearing the
  period spend and block cannot restore capacity; the next canonical gate read
  blocks it again.
- `/ops/usage` currently performs only that period reset while explicitly
  preserving the credit ledger, so its action is effective for paid included
  usage but ineffective for exhausted Starter members.
- The existing grant writer already appends an immutable positive entry and
  mutable remaining-credit projection under the beneficiary serialization
  boundary, reconciles the current block, and enforces bounded active grants.

## Implementation

1. Project a reset mode from the canonical allowance source so the table and
   confirmation distinguish exhausted Starter recovery from ordinary included
   usage reset.
2. For a canonically exhausted `direct_starter` member, append one policy-sized
   Starter reset grant with an Ops-specific semantic/source key under the
   already-held beneficiary lock. Keep ordinary paid, Family, and container
   period resets unchanged.
3. Keep notice-claim release, exact period/version compare-and-swap checks, and
   the post-commit runtime recheck. Return the committed reset kind and granted
   amount so recovery copy remains truthful when the wake needs retrying.
4. Exclude Ops reset grants from starter-enrollment growth metrics; they restore
   allowance and are not new enrollments.
5. Add focused client, service, growth-metric, and local PostgreSQL regression
   coverage, then update the canonical Ops usage contract documentation.

## Invariants

- The credit entry history is append-only; an exhausted grant projection is
  never replenished or rewritten.
- A Starter reset is admitted only from a persisted, blocked canonical
  `direct_starter` decision whose period timestamp and ledger version still
  match the displayed row.
- The member row remains the one beneficiary serialization owner for grants,
  debits, and adjustments. The transaction contains bounded database work only.
- Each successful reset adds exactly $4.50 and one grant projection. A repeat
  request with an old ledger version is stale, while a later reset after genuine
  consumption receives a new semantic key.
- Purchased/referral credits and paid included allowance keep their current
  semantics. Starter reset grants do not count as starter enrollment or trial
  conversion events.
- A current in-flight limit notice prevents mutation. A settled claim is
  released only for the pre-reset capacity epoch, before the runtime is woken
  after commit.

## Product UX

Effort: Feature. The operator gains a new billing-adjacent recovery authority,
so the owning Starter and hosted-plan product specifications define its
eligibility and repetition boundary.

Product decision:

- An authorized operator may grant one fresh $4.50 recovery allowance whenever
  the locked canonical gate shows a direct Starter member fully exhausted with
  zero total credit.
- A later recovery is eligible only after the prior credit is genuinely
  consumed and the current direct-Starter gate is fully exhausted again.
- Historical paid, purchase, or referral activity does not independently admit
  or deny recovery; current canonical state is the authority. Recovery is
  discretionary support, not an automatic refill, scheduled cadence,
  self-service entitlement, or member promise.

- Operator, exhausted Starter member: the row offers `Reset Starter`; the
  confirmation states that one fresh $4.50 allowance is granted and that
  history and purchased credits stay unchanged.
- Operator, paid/Family/group allowance: existing `Reset` behavior and copy
  remain focused on current included usage.
- Starter member after commit: canonical admission sees positive ledger credit.
  If the runtime wake is pending, the operator retries only the wake and cannot
  append a second grant. After close or reload, the page reconstructs that
  wake-only action from the active Ops grant and unconsumed mailbox work already
  denied for usage.
- Concurrent or stale operator: receives the existing refresh-and-review error;
  no partial grant, period, or notice mutation commits.

## Verification

- Run focused Vitest suites for the Ops client, dashboard/service, route,
  growth metrics, and grant/settlement behavior touched by the change.
- Run the opt-in local PostgreSQL Ops reset proof after applying current
  migrations to the isolated local test database.
- Run the Web typecheck and focused lint/static checks selected by the
  verification map, plus `git diff --check` and identifier/secret review.
- Render the real Ops usage component with synthetic Starter and paid rows and
  inspect the changed table, confirmation, success, and wake-retry states.
- Push the reviewed candidate, run Product UX + frontend + coverage preliminary
  ReviewGPT and the sensitive final ReviewGPT gate concurrently with exact-head
  CI, resolve every accepted finding, and perform the parent final review.

Current evidence:

- 94 focused service, route, growth, and rendered-client tests pass. The client
  proof covers a committed 202 response followed by close, delayed or failed
  refresh with old props, remount recovery, a later capture with unconsumed
  work, and the final capture after that work is consumed.
- The isolated local PostgreSQL proof passes both the existing paid-period reset
  and the exhausted-Starter flow. It proves a $4.50 balance, ledger version
  advance, unchanged prior entries, canonical admission, stale-replay rejection
  with exactly one Ops grant, and a later new grant only after the first recovery
  is fully consumed and the gate is exhausted again.
- Web typecheck, focused ESLint, docs drift, diff checks, and the corrected
  client and maximum-page query tests pass locally. Exact-head GitHub checks
  were running when the user requested immediate merge; the canceled or
  pending Native iOS guard was explicitly waived.
- The preliminary specialist audit identified losable Starter wake recovery,
  contradictory product authority, stale post-commit row claims, hidden
  narrow-width actions, and missing maximum-page recovery-query proof. The
  implementation now derives wake recovery from durable work state, defines the
  operator policy in the owning product specs, replaces stale accepted rows with
  one capture-epoch-scoped committed/refreshing state, exposes the same status
  and action in compact rows, and exercises both recovery reads at 25 members.
- Corrected-head Product UX verdict: **Ready**. The irreducible purpose remains
  one explicit, audited operator recovery that cannot grant twice. The ordinary
  exhausted-Starter, accepted-reset, pending-wake, reload-recovery, paid reset,
  and narrow-width operator paths now provide truthful status and a reachable
  next action. The member receives restored canonical capacity without a new
  self-service entitlement or changed credit history.
- Final ReviewGPT round 2 found that closing the pending-wake dialog could
  re-expose stale reset controls after the grant had committed. The required
  retrospective was recorded on the PR. The correction replaced three
  overlapping local authorities with one capture-scoped post-commit value:
  pending keeps only the wake-safe action, accepted is non-actionable, and a
  new dashboard capture restores canonical server ownership. The user then
  explicitly opted out of another ReviewGPT round and requested merge.
- Seven synthetic production-component captures cover the unscrolled 1184px
  dashboard, Starter confirmation, committed/refreshing result, full 390px
  dashboard, compact eligible row, pending wake, and reload-derived wake retry.
  The corrected desktop and phone layouts keep status and actions visible
  without horizontal panning or contradictory stale badges.

## Deployment

This reuses the deployed credit-entry kind and schema. Deploy Web normally; old
hosted runtimes already consume the resulting canonical balance and accept the
existing recheck signal. No Cloudflare tandem deploy or rollback floor is
introduced. Post-deploy, confirm one synthetic/staging exhausted Starter reset
adds exactly one grant and that a stale replay cannot add another.
Completed: 2026-08-18
