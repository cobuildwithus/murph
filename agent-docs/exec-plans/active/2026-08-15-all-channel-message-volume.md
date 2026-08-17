# Count all hosted message channels in public volume

Status: active
Created: 2026-08-15
Updated: 2026-08-17

## Goal

- Make the public lifetime message-volume figure accrue successful Murph
  replies sent through Telegram and email as well as Linq, while preserving
  the existing all-channel inbound count and historical baseline.

## Success criteria

- Outbound message volume has one durable, retry-safe source of truth that
  distinguishes successful Linq, Telegram, and email deliveries.
- Daily snapshots and the live public total include every supported outbound
  channel without double-counting retries, recipient fan-out, or historical
  Linq rows.
- The foreground reply critical path gains no new provider or unbounded work;
  any persistence stays at the existing delivery-commit owner.
- Existing retained totals remain monotonic across deployment and snapshot
  boundaries, with an explicit and tested cutover rule for newly tracked
  channels.
- Focused tests, typecheck, exact-head CI, the preliminary specialist pass,
  and the final ReviewGPT gate all pass before merge.

## Scope

- In scope:
  - Trace the canonical successful-delivery owners for Linq, Telegram, and
    email.
  - Extend the smallest durable aggregate or ledger boundary needed for
    all-channel outbound counts.
  - Update snapshot capture, live-total reads, tests, and durable contracts.
  - Add an honest public changelog item for the corrected website metric.
- Out of scope:
  - Reconstructing untracked historical Telegram or email sends.
  - Changing provider delivery, retry, routing, or member messaging behavior.
  - Adding member-level analytics or exposing channel-specific private data.

## Constraints

- Count accepted inbound `conversation.message` facts across all channels as
  today; do not weaken mailbox retention or privacy boundaries.
- Count one successful outbound message at the durable idempotent delivery
  owner, not provider attempts or retries.
- Define email fan-out deliberately: the public metric counts messages sent,
  and tests must lock whether a multi-recipient delivery is one message or one
  provider recipient effect.
- Preserve the 5,000-message historical baseline and avoid pretending the new
  tracker reconstructs pre-cutover Telegram or email history.
- Use existing state owners and migrations; do not introduce a parallel
  analytics service, queue, or provider call.

## Risks and mitigations

1. Risk: Provider retries inflate the public total.
   Mitigation: Accrue only from an idempotent committed-delivery fact and cover
   replay behavior with focused tests.
2. Risk: The latest daily snapshot overlaps live rows and double-counts a day.
   Mitigation: Preserve disjoint UTC snapshot/live windows and test the exact
   cutover boundary for every counted source.
3. Risk: Adding new channels retroactively changes the meaning of the fixed
   historical baseline.
   Mitigation: Keep the baseline unchanged and document that Telegram/email
   outbound coverage begins at the deployed cutover.
4. Risk: Counting recipient effects makes group email incomparable to one
   conversational reply.
   Mitigation: Follow the product's message-level delivery owner and codify the
   chosen unit in code comments, tests, and public copy.
5. Risk: Persistence on the hot reply path adds latency or failure coupling.
   Mitigation: Reuse the existing durable delivery commit with bounded database
   work and preserve provider success semantics if metric capture fails.

## Tasks

1. [x] Trace the delivery owners and implement the scoped receipt, aggregation,
   tests, and durable documentation without adding a parallel state owner.
2. [x] Add the public changelog entry and verify its responsive rendered card.
3. [x] Open PR #1917 and run focused local proof plus exact-head CI.
4. [x] Resolve the final ReviewGPT findings with the existing runner schema
   floor and outbox wake owner; final correction review passed.
5. [x] Resolve the preliminary specialist findings with truthful sent-message
   copy, a real-vault recovery test, and a real-PostgreSQL concurrency proof.
6. [ ] Push the specialist corrections, reach exact-head green, complete the
   merge-tree/base-update boundary, merge, and retire the task worktree.

## Decisions

- The website label should describe all supported hosted conversation channels,
  even though historical coverage remains bounded by the existing baseline and
  each channel's tracker cutover.
- No user or message identifiers may enter the public metric, tests, changelog,
  PR body, or review artifacts.
- Successful Telegram/email provider handoff creates one anonymous receipt
  obligation on the existing outbox intent. Signed retries upsert one Web row
  by a digest of authenticated member, channel, and stable outbox dedupe key.
- Group-email recipient children count once; the planning parent, reactions,
  and ephemeral progress sends count zero.
- Receipt retry reuses `nextAttemptAt`, the existing assistant wake projection,
  and an eight-item recovery cap. The first persisted v17 intent establishes a
  Cloudflare rollback floor.
- Public copy says "successfully sent" because provider acceptance does not
  prove handset receipt or reading.

## Verification

- Final ReviewGPT correction audit: PASS at `35d1ac1dc7`; both accepted findings
  (v17 schema floor and autonomous receipt continuation) were verified fixed.
- Preliminary specialist audit: findings resolved. The refreshed copy uses
  "successfully sent"; the real-vault recovery proof passes (1 test); the
  guarded real-PostgreSQL concurrent-upsert proof passes (1 test).
- Changelog generation and focused changelog tests pass (46 tests).
- Assistant Runtime and Web typechecks pass after the specialist corrections.
- Earlier focused suites pass for Assistant Engine (22 tests), Assistant
  Runtime delivery/callback/workspace behavior (549 tests), Cloudflare runner
  behavior (2,547 passed, 2 skipped), Web receipt/migration/growth behavior
  (56 tests), and the changelog page (8 tests).
- Pending the specialist-correction push, exact-head required CI, merge-tree
  proof, merge, and guarded worktree retirement.
