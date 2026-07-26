# Hosted usage referral rewards

Status: completed
Created: 2026-07-26

## Goal

Ship one provider-neutral referral primitive that lets a specific person arm a
reward for their personal Murph or current group, binds that reward to their
next newly created Murph group, and grants durable usage after either a new
person activates or a real group becomes active.

## Success criteria

- Personal and group sources freeze the correct personal referrer and usage
  beneficiary only after explicit acceptance.
- Linq and Telegram bind only a newly created group owned by that referrer and
  observe replay-safe human activity without broadening assistant access.
- New-person rewards require activation after arming plus target-group presence;
  active-group rewards require 15 human messages, 8 non-referrer messages, two
  distinct non-referrer speakers, and ten minutes of activity.
- Purchase and referral credit use one immutable ledger with a small
  entry-keyed remaining-capacity projection; refunds and disputes remain
  purchase-only and earned referral credit has no clawback.
- Reward celebration is idempotent and cannot roll back an already-earned grant.
- Account deletion, privacy coverage, durable product docs, and focused
  concurrency/qualification/tool/ingress tests cover the new state.
- The exact pushed PR head passes required verification, preliminary specialist
  review, final ReviewGPT, CI, and mergeability checks.

## Constraints

- Prefer existing thread routes, mailbox notifications, activation proof, and
  beneficiary locks over new routing, queue, onboarding, or accounting owners.
- Store provider-neutral keyed evidence only; never persist raw handles,
  provider message ids, or model-selected amounts.
- Do not add speculative WhatsApp code. A future ingress adapter should need
  only to normalize the same evidence.
- Preserve existing provider admission, accepted-input durability, billing,
  refund/dispute, and account-deletion invariants.
- Keep the user-facing offer conversational and low-pressure; trial credit does
  not extend the trial end date.

## Risks and mitigations

1. **Accounting divergence.** Keep immutable entries as the accounting owner,
   add one small entry-keyed remaining-capacity projection, backfill purchase
   grants in the additive migration, and retain purchase rows as payment facts
   and purchase-only financial-adjustment scope.
2. **Ambiguous group attribution.** Inject exact current-turn route/sender
   evidence outside model arguments and fail closed unless one active personal
   referrer resolves.
3. **Ingress replay or self-generated activity.** Bind only on `created: true`,
   dedupe normalized events, and require both message and speaker diversity.
4. **Notification coupling.** Commit reward authority independently, then append
   the idempotent source-mailbox celebration and its completion fence in one
   transaction. A bounded authenticated minute recovery pass retries qualified
   rewards and uncelebrated grants without introducing another state owner.
5. **Promised-cap overbooking.** Count nonexpired armed and bound commitments,
   plus qualified bound commitments even after expiry, at admission. Reserve
   under referrer plus stable-order beneficiary locks, and never apply moving
   caps after a pre-expiry qualification fence commits.
6. **Cross-deploy skew.** Keep the Prisma migration additive and referrals
   fail-closed. After the prior Web function window drains, resynchronize
   purchase projections and widen the old purchase-only ledger checks in one
   contract migration; only then enable referral production.

## Tasks

1. Write the durable product/accounting contract and additive schema migration.
2. Refactor usage-credit grant inventory and preserve purchase/refund behavior.
3. Implement the referral state machine and trusted group-tool context.
4. Add Linq/Telegram creation and observation hooks plus activation
   reconciliation.
5. Add deletion/privacy coverage and focused unit, integration, migration, and
   concurrency tests.
6. Run canonical verification, product-experience review, preliminary
   ReviewGPT, parent review, then publish and complete final ReviewGPT/CI.

## Decisions

- One referral row owns an explicitly armed destination and one bound target.
- The source conversation is re-resolved from existing member/thread routing;
  no duplicate encrypted delivery route is persisted.
- Observation mutates only the referral row. Arming acquires the beneficiary
  lock to reserve both rolling caps; observation remains lock-free with respect
  to credit, and grant reconciliation reacquires the same beneficiary lock.
- `qualifiedAt` is written atomically with the decisive evidence. Reconciliation
  may revalidate that frozen evidence after expiry but cannot withdraw the
  admitted reward because processing or another mission moved later.
- The referral row also owns celebration completion. The immediate handoff and
  bounded Vercel cron converge on one atomic mailbox append/fence; durable
  mailbox reconciliation owns a missed best-effort wake.
- New-person activation reuses normal Murph onboarding. Attribution is proven
  by activation after the arm timestamp and a linked message in the bound
  target, not by a second signup system.
- Reward policy is a small server-owned versioned catalog, not a database rule
  editor or generic incentive framework.
- `HOSTED_USAGE_REFERRALS_ENABLED=1` is the explicit rollout switch. The first
  durable referral grant establishes the compatible Web rollback floor.

## Verification

- Product-experience audit found four journey defects: moving cap overbooking,
  loss of just-in-time qualification, missing celebration retry ownership, and
  unsolicited Telegram group setup replies. Its first remediation rerun found
  one remaining expired-qualified reservation gap. One shared commitment
  predicate now covers preview, authoritative admission, and bound limits. The
  final post-remediation audit returned no findings.
- Focused Web proof: 10 files, 421 tests passed, including referral policy/tool,
  recovery cron, Linq/Telegram ingress, visible-secondary behavior, usage
  credit, group tool, and account deletion.
- Web TypeScript proof: `pnpm --dir apps/web typecheck:prepared` passed.
- Fresh isolated PostgreSQL proof: all 126 normal Prisma migrations and all 11
  production contract migrations applied. All referral and usage-credit
  constraints validated.
- Real PostgreSQL serialization proof: 8 tests passed. It covers purchase grant
  replay, grant/debit ordering, lock order, deletion races, a pre-expiry
  qualification reconciled after expiry into one final referral grant, actual
  FIFO consumption of that grant, and different group referrers contending for
  one beneficiary's final cap capacity while an expired-qualified mission
  remains reserved. Replaying reconciliation through a missing route still
  leaves exactly one immutable grant.
- The isolated task database was dropped after proof and confirmed absent.
- A canonical remote acceptance attempt exposed one stale Vercel cron inventory
  assertion after every other reported Web test and the production build
  completed. The inventory test now includes the referral recovery cron;
  focused rerun passed.
- Exact-patch canonical acceptance passed on Blacksmith Testbox
  `tbx_01kyg0abhyntzyzbdztq543nhc` in 4m38s, including full workspace
  typecheck, package coverage, Web tests/lint/dev smoke/production build, and
  Cloudflare verification. The delegated Actions proof is run `30218111295`.
- Preliminary specialist ReviewGPT completed in 16 minutes with two accepted
  coverage findings and no prompt finding. The direct privacy test now asserts
  the rewarded-survivor anonymization and unrewarded/beneficiary deletion
  predicates and payload. The real PostgreSQL suite is now 9/9 and adds a
  production-faithful new-person activation with a valid Linq source route,
  exactly one grant and deterministic celebration, a completion fence and
  first wake, and replay with no duplicate work.
- Post-remediation canonical diff verification passed on Blacksmith Testbox
  `tbx_01kyg21ss3g1s82rgjmnt8ztkk` in 2m1s. The delegated Actions proof is run
  `30219194499`.
- Post-remediation full canonical acceptance passed on Blacksmith Testbox
  `tbx_01kyg21xj3zbhbngtcam24eq29` in 4m35s. The delegated Actions proof is run
  `30219196435`.
- Parent final review found no remaining correctness, accounting, privacy,
  ingress-authority, reliability, deployment-compatibility, or simplicity
  finding in the candidate plus preliminary-remediation delta.
- Final ReviewGPT, CI, and mergeability remain pending.
Updated: 2026-07-26
Completed: 2026-07-26
