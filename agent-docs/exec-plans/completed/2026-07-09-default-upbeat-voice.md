# Default Upbeat Murph Voice

## Goal

Make the existing upbeat voice the default and present it as "Classic Murph," while preserving the previous Classic audio as a renamed selectable voice for existing and future members.

## Constraints

- Preserve stable persisted voice ids so saved preferences do not need a migration.
- Keep the previous Classic audio bound to its existing env-backed id.
- Use one shared default id for the picker and voice-memo runtime resolution.
- Keep the implementation small: roster/default data, focused consumers, tests, and the durable product spec only.
- Do not regenerate preview audio; the existing clips already match the two retained voice ids.

## Plan

1. Promote the existing `upbeat` option to the first "Classic Murph" roster entry and rename the env-backed `classic` option to "New York."
2. Export a shared default voice option id and use it for picker initialization and no-preference voice-memo resolution.
3. Update focused contract/UI tests and the tone-and-voice product spec.
4. Run scoped verification, required coverage/frontend audits, final review, and the plan-aware scoped commit.

## Verification

- `pnpm test:diff packages/contracts/src/preferences.ts apps/web/src/components/murph/murph-assistant-style-picker.tsx`
- Focused contracts and picker tests as needed during iteration
- Direct roster/default readback
- `git diff --check`

## State

Complete. The frontend and coverage-write audits found no remaining actionable
findings. The app-only diff lane passed web tests, lint, dev smoke, production
build, and typecheck. Contracts and focused assistant-planning tests passed. The
broader reverse-dependent lane remains blocked only by the unchanged
assistant-CLI startup-import test timing out during module transformation; the
same timeout reproduces when that test runs alone.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
