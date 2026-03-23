# setup onboarding runtime-env + wearable handoff

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Make `healthybob setup|onboard` feel like a short guided onboarding flow instead of a long wall of text, while surfacing channel and wearable readiness inline and letting operators connect Oura/WHOOP immediately when credentials are ready.

## Success criteria

- Interactive `setup|onboard` uses a compact Ink stepper with assistant, channel, wearable, and review stages.
- Channel and wearable choices show readiness and missing-env state during onboarding instead of failing later without context.
- Missing runtime env vars can be entered for the current run only, with explicit copy that prompts apply only to the current process and are not persisted back to env files.
- Setup results and CTA output report missing env cleanly and offer the next useful commands, including `device connect <provider> --open` when a selected wearable is ready.
- After successful interactive onboarding, selected ready wearables open their existing OAuth connect flow before the assistant handoff continues.
- Focused tests cover wizard plumbing, runtime env prompting, and setup result behavior for channels and wearables.

## Scope

- In scope:
  - setup wizard UI/content refresh in Ink
  - setup result contract updates for missing env and wearables
  - runtime env detection/prompt plumbing for email/Telegram/Oura/WHOOP
  - post-setup wearable connect handoff via existing `device connect`
  - targeted docs/tests updates
- Out of scope:
  - changing device-sync OAuth/provider contracts
  - persisting raw secrets beyond the current shell process
  - changing assistant chat/runtime behavior outside the existing setup handoff

## Risks and mitigations

1. Risk: setup results and wizard plumbing drift apart.
   Mitigation: thread runtime readiness from one shared helper module and add focused tests around the setup CLI surface.
2. Risk: prompting for secrets could imply env-file persistence.
   Mitigation: keep copy explicit that only current-process env overrides are applied and never written back to `.env` files.
3. Risk: post-setup device-connect handoff could block or confuse assistant launch behavior.
   Mitigation: only auto-open selected wearables that are actually ready, print explicit notices for deferred selections, and preserve the existing assistant launch decision after the wearable handoff.

## Tasks

1. Add setup runtime-env helpers, expand setup result contracts to include missing env plus wearable status, and thread those results through setup services.
2. Refresh the Ink wizard into a short stepper with inline readiness badges, optional wearable selection, and review copy that explains deferred credentials clearly.
3. Update post-setup handoff and CTA behavior to launch selected ready wearables and document/test the new onboarding flow.

## Verification

- Focused: `pnpm exec vitest run --coverage.enabled=false packages/cli/test/setup-cli.test.ts packages/cli/test/setup-channels.test.ts --maxWorkers 1`
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`
Completed: 2026-03-23
