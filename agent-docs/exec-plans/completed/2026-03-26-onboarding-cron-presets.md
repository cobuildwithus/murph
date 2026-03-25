# Onboarding cron preset selection

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Add a setup/onboard wizard step that lets new users review assistant cron presets, starts with a sensible 1-2 preset bundle enabled by default, and installs the selected preset-backed jobs during setup.

## Success criteria

- Interactive `healthybob setup` and `healthybob onboard` runs include a dedicated cron-presets step in the Ink wizard.
- The step uses toggle-style selection, preselects a small default bundle, and still lets the operator add or remove presets before confirming.
- Selected presets are installed as real assistant cron jobs during setup without changing existing cron runtime behavior.
- Non-interactive and explicit-JSON setup flows keep working without forcing preset installation.
- Focused tests cover wizard state, default selection, setup handoff, and preset installation behavior.

## Scope

- In scope:
  - setup wizard UI/state for cron preset selection
  - setup result/contracts/service plumbing for selected preset ids
  - setup-time installation of selected assistant cron presets
  - focused setup/cron test coverage
- Out of scope:
  - editing preset definitions beyond selecting a default starter bundle
  - new runtime semantics for cron execution
  - background cron execution outside `assistant run`

## Risks and mitigations

1. Risk: setup currently tracks assistant/channel/wearable choices only.
   Mitigation: thread preset ids through setup with additive fields and preserve existing defaults for non-interactive flows.
2. Risk: automatically enabling too many jobs makes onboarding noisy.
   Mitigation: keep the default bundle to 1-2 broadly useful presets and make the screen opt-out with clear toggles.
3. Risk: preset installation can conflict with existing named jobs.
   Mitigation: use the existing preset install path and add targeted tests around the setup-time materialization seam.

## Tasks

1. Inspect the current Ink setup wizard flow and identify the smallest insertion point for a cron-presets step.
2. Add wizard state/helpers/defaults for preset toggles and return the selected preset ids through setup.
3. Install selected presets during setup and keep non-interactive/setup-skip flows stable.
4. Add focused tests, run required audits/checks, and record outcomes.

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Added a dedicated setup wizard step for scheduled update presets between assistant selection and channel selection.
- Defaulted interactive onboarding to a small starter bundle of `environment-health-watch` and `weekly-health-snapshot`, while allowing operators to toggle all presets on or off.
- Installed the selected preset-backed cron jobs during setup, reusing existing jobs with matching preset names instead of overwriting them.
- Surfaced installed scheduled updates in the setup result and added a follow-up CTA to inspect them with `assistant cron list`.

## Verification results

- Passed:
  - `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm typecheck`
- Failed for unrelated pre-existing reasons outside this setup/onboarding change:
  - `pnpm test`
    - the repo-wide `packages/cli/test/runtime.test.ts` sweep fails across unrelated document, meal, journal, workout, device, and export-pack commands
  - `pnpm test:coverage`
    - the run stops in `pnpm no-js` because tracked generated `.js`/`.d.ts` source sidecars already exist across multiple packages
Completed: 2026-03-26
