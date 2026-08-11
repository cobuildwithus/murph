# Harden appointment reminder ownership

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the default private appointment reminder collision-safe when created and
  recoverable by exact owner after provider-thread continuity is unavailable.

## Success criteria

- An initial appointment reminder uses create-only opaque ownership and cannot
  overwrite an existing reminder with a matching semantic title or date.
- The hosted automation tool can read a bounded, current-conversation-only list
  of persisted automation owners without exposing delivery-route identifiers.
- Natural reschedule and cancellation replies patch the original owner and
  never create a replacement or rename its lookup slug.
- Opt-out, tentative, unavailable, unchanged, ambiguous, failed, and
  timing-unverified routes produce truthful final responses.
- Focused tests, exact-head completion reviews, CI, and direct-push acceptance
  pass before the candidate reaches `main`.

## Scope

- In scope: the canonical automation create boundary, the hosted automation
  tool's current-conversation read surface, the typed local create-only CLI
  surface, appointment scheduling policy, focused runtime/tool/prompt tests,
  and real App Server scenario coverage.
- Out of scope: new databases or runtime stores, generic appointment-record
  persistence, route retargeting, frontend changes, and unrelated automation
  behavior.

## Constraints

- Canonical automation records under the vault remain the only durable owner.
- Read results must be current-conversation scoped and omit route fields.
- Existing ordinary upsert behavior remains compatible unless create-only is
  explicitly requested.
- No reminder success claim is allowed unless the initial result proves a new
  record was created or an exact trusted replay recovered it, and timing claims
  match the returned verification fields.

## Risks and mitigations

1. Risk: a generated owner still collides or races with another writer.
   Mitigation: enforce create-only conflict refusal inside the canonical locked
   mutation, not only in the hosted adapter.
2. Risk: a read action leaks automations from another conversation.
   Mitigation: compare each persisted route to the trusted current route before
   serialization and never return route fields.
3. Risk: model tests inject hidden owner context and miss fallback behavior.
   Mitigation: share real tool state across resumed turns and add a fresh scoped
   runtime read proof independent of provider-thread memory.

## Review retrospective — round 2

ReviewGPT found that the first replay correction still treated the accepted
input as the effect identity. That made two appointment creates from one
accepted message collide, while the retained local create-only route used a
fresh random identity and could duplicate an effect after result loss.

The requirement-level decisions are:

- Effect cardinality is one owner per distinct canonical appointment-reminder
  payload. One accepted input may create multiple distinct reminder effects.
- Hosted and privileged-local create-only routes are both retained and both
  must be replay-safe. There is no random create-only ownership mode.
- Core owns one contract: canonical payload identifies the product effect;
  hosted accepted-input authority scopes that effect when available; an
  execution attempt never participates in identity.
- Exact payload replay returns the existing owner without a write. Distinct
  payloads under one accepted input produce distinct owners. Later lifecycle
  operations address only the returned owner id or opaque lookup id.
- Required proof covers two creates from one accepted message, replay after an
  ambiguous/lost result on each retained route with no additional record, and
  independent reschedule/cancellation of the corresponding original owners.

This redesign replaces both compensating modes in the prior correction: the
accepted-input-only hosted id and the random local id. It adds no durable owner,
secondary index, or lifecycle.

## Review retrospective — round 3

ReviewGPT found that the round-2 payload fingerprint still represented the
assistant's generated write arguments rather than the appointment effect.
Equivalent timestamps, tag order, or harmless title, summary, and instruction
changes could therefore create a second owner after result loss.

The requirement-level decisions are:

- The smallest hosted appointment-effect identity is the trusted accepted input
  plus the appointment's one-based ordinal in that input's visible appointment
  order. No reminder schedule, timestamp spelling, tag, status, title, summary,
  instruction, route, or other mutable write field participates.
- The canonical model-facing discriminator is the strict token
  `appointment-reminder:<ordinal>`. The host supplies accepted-input authority;
  core derives id and lookup slug only from the tuple of schema, trusted scope,
  and discriminator.
- Two appointments in one input, including two whose reminders share a delivery
  instant, remain distinct by their source order. Regeneration must reuse that
  source order even if tool-call order or presentation copy changes.
- The privileged-local automatic appointment path is removed. That route has no
  trusted accepted-input authority, and inventing a local source owner or
  accepting a model-generated global key would repeat the same identity defect.
  The typed local create-only option introduced only to support that promise is
  removed with it.
- Required proof changes mutable copy, tag ordering, and equivalent timestamp
  spelling across hosted replay; creates two same-delivery-time appointments
  with distinct ordinals; verifies independent reschedule/cancellation; and
  verifies the local route truthfully performs no automatic reminder write.

This direction continues to use the existing automation record and registry
lock. It deletes the unsupported parallel route and adds no index, queue,
reconciliation loop, state machine, or durable identity owner.

The implemented correction follows that decision: hosted create-only saves now
require the strict source-ordinal discriminator, core derives both opaque owner
keys only from that discriminator plus trusted replay scope, and the local CLI
create-only option and appointment promise are deleted.

## Review retrospective — round 4

ReviewGPT found that the round-3 hosted scope was read from the mutable set of
accepted inputs at each tool call. If input A's appointment write committed but
its result was lost, then input B joined the same live turn before regeneration,
the host could replace A with B as the effect authority and create a duplicate.
The same last-input rule could not distinguish separate appointment ordinals
when a provider request grouped multiple accepted messages.

The requirement-level decisions are:

- The immutable authority unit is one exact accepted input, not the mutable
  provider-request batch. Each input receives a deterministic, host-generated
  opaque appointment source reference in the prompt.
- A create-only save supplies that opaque source reference plus the existing
  `appointment-reminder:<ordinal>` discriminator. The ordinal is one-based only
  within that source input's visible appointment order.
- The host resolves the opaque reference against its accepted-input journal and
  derives the replay scope from the matched accepted-input id and trusted
  conversation route. It never treats a raw model-supplied input id as
  authority, and mutable batch order or mailbox tails do not participate.
- A later accepted input is a separate authority scope. Regenerating input A's
  save after input B joins continues to resolve A, while B's first appointment
  has its own source reference and can independently use ordinal one.
- Required proof covers a committed result lost before a later input joins,
  separate first appointments from two accepted messages, replay under a
  differently composed batch, and independent lifecycle operations that touch
  only the two original owners.

This correction continues to use the existing automation record,
accepted-input journal, and registry lock. It adds no durable owner, index,
queue, reconciliation loop, or state machine.

## Review retrospective — round 5

ReviewGPT found that a provider-authenticated Linq edit has a new ingestion
event id but is explicitly a correction to `editedSourceInputId`, not a
separate request. Giving every ingestion event its own appointment authority
would therefore duplicate an ambiguously committed reminder after a message
edit, while merely replaying the original owner would leave its old schedule.

The requirement-level decisions are:

- A trusted correction is a revision of the original accepted message's
  appointment-effect authority. Existing, changed, reordered, or removed
  appointments inherit the original message's opaque appointment source ref;
  ingestion-event identity alone never makes them new effects.
- A correction also receives a separate opaque correction-added source ref,
  but that ref is valid only for a genuinely new appointment introduced by the
  correction. Its ordinal is one-based among appointments newly introduced by
  that correction, not the correction's complete visible appointment order.
- Appointment correspondence comes from the original and corrected evidence
  plus persisted route-scoped owners, never list order. Existing appointments
  retain and patch their exact owner, removed appointments archive their exact
  owner, and reordering never reassigns an ordinal. If correspondence remains
  ambiguous, the assistant makes no create or mutation and asks one narrow
  identifying question.
- After an ambiguous original commit, a trusted correction first recovers with
  shared stable evidence such as destination or service plus the original and
  corrected details. It patches the recovered owner to the authoritative
  corrected schedule. A create-only replay may recover the owner id, but its
  unchanged stored schedule is never treated as applying the correction; the
  exact owner must then be patched.
- A correction may create only when route-scoped reads establish that no
  plausible owner exists. Original-lineage appointments use the original
  source ref and original ordinal; genuinely added appointments use the
  correction-added source ref and added-appointment ordinal.
- Required proof discards A's committed result, admits trusted correction C
  targeting A, recovers one owner and patches its schedule, preserves unrelated
  owners across insert/remove/reorder cases, keeps independent input B
  separately owned, and leaves no stale duplicate after cancellation.

The host derives correction lineage from the existing trusted
`editedSourceInputId` input-event metadata and accepted-input journal. The
workflow continues to use the canonical automation record and registry lock;
it adds no secondary identity index, reconciliation loop, queue, state machine,
or durable owner.

The implemented correction renders both refs only for trusted Linq correction
inputs, validates the original lineage against the stored account, actor,
thread, directness, and service authority before accepting the original ref,
and keeps the correction event ref available only for genuinely introduced
appointments. Stateful runtime proof now recovers an ambiguously committed
owner, observes its unchanged replayed schedule, patches the exact owner,
creates and removes a correction-added owner independently, preserves an
unrelated accepted input across reorder and lifecycle operations, and leaves
one archived owner after cancellation.

## Tasks

1. [x] Add canonical create-only ownership and hosted current-conversation list.
2. [x] Update the appointment policy to use create-only save and exact-owner list.
3. [x] Replace synthetic owner tests with stateful lifecycle and fallback proof.
4. [ ] Run focused verification, completion reviews, exact-head CI, and acceptance.
5. [ ] Push the verified candidate to `main`, close the draft PR, and retire the worktree.

## Verification

- Focused core automation tests for create-only collision refusal.
- Focused hosted runtime tests for current-conversation list scoping and response
  redaction.
- Assistant Engine dynamic-tool, policy, model-behavior, planning, typecheck,
  and credential-gated real App Server appointment scenarios.
- Exact-head specialist and final ReviewGPT gates, GitHub checks, privacy/diff
  inspection, and `pnpm verify:acceptance` after final reconciliation with
  `origin/main`.

Completed focused proof:

- All four affected package typechecks pass.
- Core: 25 focused automation tests pass.
- Assistant Engine: 242 focused policy, tool, planning, and skill tests pass;
  credential-gated real App Server cases remain registered and skipped without
  the live provider credential.
- CLI: 86 focused automation and generated-contract tests pass.
- Assistant Runtime: the scoped hosted-automation integration case passes, with
  the remaining cases intentionally excluded by the focused filter.
