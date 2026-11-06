# Game invite wording follow-up

Status: completed
Created: 2026-10-23
Updated: 2026-10-23

## Scope and outcome

A newly added backend-tagged QA item extends the authorized follow-up PR.
Use artifact terminology on public invites, shorten the five-weekday schedule,
and remove instructions for a nonexistent in-app paste control. Preserve the
existing app deep link and copy-link action. No route, auth, or data changes.

## Ownership and proof

Existing invite copy and production view own all wording. The existing design
study and Playwright capture exercise those components at phone and desktop
widths; focused invite tests and Web typecheck verify the unchanged handoff.

## Product UX

Outcome: explain the daily choice and schedule with truthful actions.
Reaches: open any-kind/legacy invites, weekday/custom/count schedules, and closed
invites. Proof: production-component render and existing browser design study.

## Verification

Passed: 15 invite/changelog tests, Web typecheck, complexity (no hotspots),
logs guard, docs drift, and both existing Playwright design-proof cases at
390 and 1280 pixels. Parent inspected the captured any-artifact views at native
resolution: wording, layout, and actions are correct. Product UX: Ready.
A source preview and attached synthetic captures provide review evidence.
Final ReviewGPT and exact-head CI cover the combined backend PR.
Completed: 2026-10-23
