# PR 800 system-notification boundary

Status: completed
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

- [x] Separate genuine occurrences from one-shot system notifications in the
  shared notification entrypoint.
- [x] Make output-only a runner-enforced no-tool invariant and give detached
  system notifications a small non-scheduled formatting prompt.
- [x] Add planner, notification runtime, system-mailbox, and provider-lifecycle
  production-path tests.
- [x] Run scoped verification, the required coverage-write audit, GitHub CI,
  and ReviewGPT correction-verification rounds against their exact pushed
  heads.

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
- The round-3 anomaly retrospective retained one indivisible PR: scheduled
  parity broadens the shared notification entrypoint, so the occurrence
  discriminator and detached boundary are required to ship it safely. Each
  concern remains in an existing owner, with no new scheduler stack, state,
  service, pool, manager, or delivery owner.

## Verification

- Focused assistant-engine runtime suites: 216 passed.
- Assistant-engine typecheck: passed.
- Required coverage-write audit: 2,526 passed, 5 skipped; 89.63% statements,
  82.06% branches, 94.16% functions, and 89.65% lines.
- GitHub PR checks: 25 passed on the final substantive head.
- ReviewGPT round 3: attested `PASS` with no qualifying findings. Two earlier
  clean diagnostic responses were rejected by the mandatory ten-minute model
  attestation floor and did not count.
- Diff check and privacy/identifier scan: passed before the substantive commit.
Completed: 2026-07-20
