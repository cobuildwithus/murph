# PR 800 system-notification boundary

Status: active
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Close ReviewGPT round 1's authority finding without weakening genuine
  scheduled-turn parity or recreating a scheduled-only assistant stack.

## Success criteria

- A notification carrying a real `scheduledOccurrenceAt` continues through the
  ordinary conversation prompt, session thread, planner, skills, and dynamic
  tools.
- A model-backed one-shot system-mailbox notification with no occurrence runs
  as an isolated output-only formatter with no conversation history, resume
  mutation, CLI, hosted tools, browser, apps, shell, network, or other effect
  surface.
- Ordinary prompts describe a scheduled automation only when a real occurrence
  is present.
- Phone-call result and Family confirmation paths retain one natural delivery
  while adversarial embedded text cannot expose or invoke tools.

## Scope

- In scope: discriminate the two callers at the shared notification boundary,
  add the narrow output-only system-notification prompt, centralize output-only
  tool disabling in the Codex runner, and add focused production-path proof.
- Out of scope: changing scheduler persistence, occurrence identity, delivery
  routing, producer schemas, or unrelated CLI baseline failures.

## Constraints

- The scheduler still owns only timing, route, and delivery adaptation.
- Do not restore `notification-decision` or `notification-turn` as scheduled
  assistant profiles.
- Use existing ephemeral `scheduledOccurrenceAt`; add no persisted authority
  state or trigger framework.
- Preserve maintenance exact-skip and exact-text fast paths.

## Tasks

1. Separate genuine occurrences from one-shot system notifications in the
   shared notification entrypoint.
2. Make output-only a runner-enforced no-tool invariant and give detached
   system notifications a small non-scheduled formatting prompt.
3. Add planner, notification runtime, and system-mailbox production-path tests.
4. Run scoped verification, commit and push the remediation, then run CI and
   ReviewGPT round 2 against the new exact head.

## Decisions

- A scheduled automation occurrence is an ordinary user turn with trusted
  occurrence context. A system mailbox event is not a user turn and therefore
  receives no user-turn capability surface.
- The distinction is derived from the existing occurrence field at the shared
  turn boundary, not from a new authority object, service, or persisted state.
- Restrictive output-only config is launch identity, not request-local state.
  Detached system notifications therefore use the existing one-shot provider
  process so they cannot replace the resident ordinary-turn process or kill
  valid detached enrichment.
