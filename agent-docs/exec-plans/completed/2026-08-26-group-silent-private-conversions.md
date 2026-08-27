# Count silent group participants who activate privately

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Count a person once when Murph observed them in a routed Linq group before
  their first private activation, even if they never sent a group message.
- Preserve the existing durable member conversion marker and `/ops/growth`
  projection as the only long-lived aggregate truth.

## Success criteria

- Current, non-Murph Linq roster participants create only blinded,
  deduplicated attribution evidence during the existing post-response roster
  reconciliation.
- A later private activation marks the existing member conversion field; group
  messages remain a fallback evidence source and cannot double count.
- Observation writes are set-based and bounded by the existing 32-participant
  roster cap, add no provider or crypto work, and stay outside the foreground
  reply transaction.
- Unmatched evidence expires after 14 days through the existing bounded hourly
  retention owner.
- Focused unit and PostgreSQL proof, Web typecheck, required ReviewGPT gates,
  and exact-head CI pass.

## Scope

- In scope: Linq roster evidence, one small blinded observation table, daily
  attribution into the existing member marker, bounded retention,
  migration/schema, focused proof, and architecture docs.
- Out of scope: historical backfill without retained evidence, Telegram roster
  discovery, per-group funnels, per-member ops UI, third-party analytics,
  queues, timers, provider calls, and new dashboard components.

## Constraints

- Technical constraints: store only versioned contact lookup keys and
  timestamps; no raw handles, route ids, group ids, message content, or new
  secrets. Keep writes idempotent and set-based. Attribute asynchronously in
  the existing growth snapshot owner so activation and reply latency do not
  change.
- Product/process constraints: the metric means “observed in a Murph group
  before private activation.” Roster presence is exposure evidence, not
  engagement, identity authority, membership authority, or proof of a network
  effect. The internal Ops explanation must state both roster and retained
  message evidence so operators do not mistake exposure for engagement.

## Risks and mitigations

1. Risk: Analytics state accidentally becomes identity or access authority.
   Mitigation: Keep it in a dedicated short-lived table with no member or group
   foreign key, and consume it only from the growth snapshot path.
2. Risk: Collection growth or retention work adds database pressure.
   Mitigation: Global dedupe by lookup key, 14-day expiry index, bounded serial
   cleanup in the existing hourly retention job, and one set-based roster write
   at the existing 32-person cap.
3. Risk: Deployment skew exposes code before its table exists.
   Mitigation: Additive migration first, then Web deploy. Old Web ignores the
   table; rollback leaves inert expiring rows and remains safe.
4. Risk: Contact-privacy key rotation during the short observation window can
   create a false negative.
   Mitigation: Use the canonical current lookup key and retain the existing
   message-based attribution fallback; do not add raw or separately keyed
   identity storage merely for an analytics edge case.
5. Risk: Account recreation can match still-live global roster evidence.
   Mitigation: Treat the evidence as non-authoritative group-derived analytics,
   omit it from user exports, and cap its lifetime at 14 days. The user
   explicitly chose bounded expiry over synchronous account-deletion coupling.
6. Risk: Concurrent rosters share observation keys and acquire them in opposite
   orders, aborting participant reconciliation with a database deadlock.
   Mitigation: Order the existing observation input by its primary key inside
   the same set-based statement.

## Tasks

1. Add the minimal observation schema, migration, and architecture contract.
2. Record bounded blinded observations inside the existing set-based roster
   reconciliation without affecting user-critical success paths.
3. Attribute eligible activated members into the existing marker and expire
   old observations through existing owners.
4. Add focused unit/migration/PostgreSQL proof and run scoped verification.
5. Commit, open the PR, run preliminary coverage and final ReviewGPT gates with
   CI, resolve accepted findings, merge once green, and retire the worktree.

## Decisions

- State classification: short-lived derived analytics evidence in the hosted
  control database; it is neither canonical member truth nor authority.
- Fourteen-day expiry is the complete lifecycle contract. Account deletion does
  not synchronously delete global roster observations or add lock coupling to
  participant reconciliation.
- The observation upsert orders rows by the existing contact-key primary key.
  This keeps concurrent writers deterministic without another lock, query,
  transaction, retry, or owner.
- Reuse the current group-to-private member marker and ops chart unchanged.
- Do not add a participant-event side path: the existing roster reconciliation
  observes the complete current room after group activity and already owns the
  provider cap, filtering, scheduling, and failure behavior.
- Product UX applies to the internal Ops operator: the metric definition must
  name both evidence sources and describe sequence-based exposure attribution.
  Prompt and member-facing frontend lenses are not applicable. Coverage is
  applicable.
- Final ReviewGPT is applicable because the change adds persisted state and
  composes provider evidence, retention, and analytics owners.

## Verification

- Passed: 506 focused deterministic Vitest tests covering observation SQL,
  group reconciliation, growth attribution, retention, migration, and hosted
  privacy schema guards.
- Passed: three opt-in local PostgreSQL tests for set-based silent roster
  observation, production writer-to-attributor composition, idempotent marking,
  and reversed-order concurrent reconciliation through two database connections.
- Passed: Web typecheck, focused ESLint, and `git diff --check`.
- Accepted the Ops-copy and composed-proof findings. The user rejected
  synchronous account-deletion cleanup in favor of the existing 14-day expiry.
  Removing that helper also removes round two's lock-order cycle; no replacement
  lock, retry, relation, queue, service, or lifecycle was added.
- Accepted round three's independent roster-writer ordering finding. One SQL
  `ORDER BY` plus a focused PostgreSQL proof resolves it without new production
  machinery.
- Passed: final ReviewGPT round four on the exact pushed remediation head with
  no remaining findings.
- Expected outcomes: silent roster evidence attributes exactly once only after
  activation, invalid/self/removed inputs do not observe, message and roster
  evidence dedupe at the existing marker, expired evidence is boundedly
  removed, the Ops definition matches both evidence sources, and no existing
  group authority behavior changes.
Completed: 2026-08-26
