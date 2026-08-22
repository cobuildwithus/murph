# Delegated Message Recovery

## Outcome

Restore both user-invoked delegated messaging directions so accepted work reaches
one timely terminal outcome: private-to-group handoffs produce a valid delivery
decision before their existing deadline, and group-to-private asks cannot starve
behind retained model-free maintenance work.

## Classification

- Task class: high-risk cross-cutting runtime reliability fix.
- Product UX effort: Patch.
- Changelog: applicable because the recovery is member-visible.
- Final review: preliminary Product UX, prompt, and coverage lenses plus the
  sensitive cross-cutting final ReviewGPT gate.

## Proven causes

1. The private-to-group notification selects the ordinary conversation prompt
   while its caller parses the strict notification decision contract. Existing
   tests mock an already-valid provider response and do not inspect the planned
   prompt.
2. Imported private-to-group work loses its durable deadline and can retry after
   the source mailbox row expires.
3. A system-mailbox invocation executes only model-free actions. A later
   user-invoked assistant ask can be imported locally while an older retained
   model-free row keeps orchestration in that mode, leaving the ask unexecuted.

## Affected people and journeys

- A person delegating from a private conversation to a consented group: the
  handoff uses current group context, sends at most once, and expires without a
  stale later message.
- A group participant asking the current sender's private assistant: the advance
  notice remains disclosure-safe, accepted work reaches the private assistant,
  and the existing fixed completion or cannot-answer result returns once.
- A person whose delegated work crosses its deadline: no model call or delivery
  occurs after expiry, retries stop, and the durable handled frontier can advance.
- A person sending ordinary foreground conversation input while delegated work
  is pending: foreground reply priority is unchanged.

## Implementation plan

1. Give context-handoff notification planning an explicit contract signal and
   committed group transcript access without broadening ordinary output-only
   turns.
2. Enforce the existing handoff deadline in the local system-mailbox owner so
   already-imported stale work terminalizes without provider or delivery work.
3. Upgrade a system-mailbox invocation to the normal assistant path when the
   selected local owner is a due user-invoked assistant ask, while preserving
   foreground preemption and retained maintenance state.
4. Remove any generic model-backed handoff from the pre-checkpoint exact-effect
   family if direct proof confirms the current classification violates the hot
   reply boundary.
5. Add focused composed regressions, update public owner docs and changelog only
   where the shipped behavior changes, then run scoped tests and typechecks.
6. Push the exact candidate, run specialist and final ReviewGPT concurrently
   with CI, disposition findings, perform the parent review, and close this plan.

## Verification

- Assistant-engine planning and notification runtime tests inspect the actual
  contract-bearing prompt and committed transcript behavior.
- Assistant-runtime system-mailbox and workspace-entrypoint tests cover fresh,
  expired, retained-maintenance, foreground-preemption, and no-repeat paths.
- Focused package typechecks for every changed owner.
- Product UX walkthrough replays both directions plus expiry and foreground
  interruption using synthetic, non-identifying fixtures.
- Exact pushed-head CI, preliminary completion specialists, sensitive final
  ReviewGPT, and a clean current-base merge-tree.

## Deployment

Prefer a rolling-compatible public runtime change that derives the existing
deadline from already-present trusted fields and does not require a new schema.
If the final patch changes a cross-service contract, document and verify the
compatible deployment order before handoff.
