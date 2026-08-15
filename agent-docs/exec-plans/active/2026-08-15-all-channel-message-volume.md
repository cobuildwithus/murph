# Count all hosted message channels in public volume

Status: active
Created: 2026-08-15
Updated: 2026-08-15

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

1. Have ReviewGPT trace the delivery owners and return a scoped implementation
   patch with tests and durable documentation.
2. Inspect and apply the patch, rejecting any parallel state or retry-sensitive
   counting design.
3. Run focused proof, add the changelog fragment, and review the final diff.
4. Commit, push, open the PR, and start exact-head CI plus both routed ReviewGPT
   stages concurrently.
5. Resolve every accepted finding, reach exact-head green, merge, and retire
   the task worktree through the guarded helper.

## Decisions

- The website label should describe all supported hosted conversation channels,
  even though historical coverage remains bounded by the existing baseline and
  each channel's tracker cutover.
- No user or message identifiers may enter the public metric, tests, changelog,
  PR body, or review artifacts.

## Verification

- Pending ReviewGPT implementation handoff.
- Pending focused tests and typecheck.
- Pending preliminary specialist and final ReviewGPT gates.
- Pending exact-head required CI and merge-tree proof.
