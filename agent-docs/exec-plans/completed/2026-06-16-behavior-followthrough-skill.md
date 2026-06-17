# Behavior Follow-Through Skill

## Goal

Land the `behavior-followthrough` assistant skill as a prompt/skill asset with
minimal integration bridges for repeated behavior support.

Success criteria:

- The skill is registered and its `SKILL.md` ships with assistant-engine assets.
- The global assistant prompt only contains a small route bridge, not the full
  behavior framework.
- Experiment onboarding and notification-decision guidance preserve the compact
  follow-through loop for scheduled support.
- Prompt/skill regression tests cover the new skill route and bridges.
- Focused assistant-engine tests and required repo checks pass.

## Scope

- In: assistant skill asset, assistant skill registry, assistant system prompt
  behavior/automation/notification bridge, experiment-onboarding skill bridge,
  prompt regression tests.
- Out: new habit engine, schema, persisted state model, generated catalogs,
  runtime scheduling mechanics beyond prompt guidance.

## Constraints

- Preserve existing assistant-engine ownership and active-work overlap.
- Keep detailed behavior policy in the skill file; keep system prompt changes
  short.
- Do not expose local identifiers, secrets, absolute home paths, or raw private
  values in files, commits, logs, or PR text.

## Plan

1. Add the skill asset and register it after `experiment-onboarding`.
2. Add small system prompt, notification-decision, automation, and
   experiment-onboarding bridges.
3. Update regression tests for skill refs, route hints, notification behavior,
   and experiment-onboarding bridge guidance.
4. Run focused assistant-engine tests, `pnpm typecheck`, and smoke verification.
5. Run required prompt-review audit, resolve findings, and commit through
   `scripts/finish-task`.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
