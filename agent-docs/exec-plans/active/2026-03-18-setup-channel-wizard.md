# setup/onboard channel wizard + iMessage auto-reply bootstrap

Status: active
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Turn `healthybob setup` and `healthybob onboard` into an interactive onboarding flow that can select external message channels, default to iMessage, and leave Healthy Bob ready to auto-reply to new inbound iMessages through the assistant runtime.

## Success criteria

- `healthybob onboard` is a first-class alias for the setup surface, and interactive runs of either `setup` or `onboard` show a terminal wizard before provisioning finishes.
- The wizard supports arrow-key navigation and Space toggles, with iMessage selected by default and Telegram shown as a disabled coming-soon option.
- Setup provisions or reuses the local iMessage source during onboarding and records assistant auto-reply channel state in the assistant runtime when iMessage remains enabled.
- After a successful interactive onboarding with iMessage enabled, the CLI launches `assistant run` instead of dropping straight into chat so inbound iMessages can create or continue assistant sessions automatically.
- Focused tests cover wizard gating, onboard alias routing, setup launch-mode selection, assistant auto-reply priming, and new inbound iMessage reply behavior.

## Scope

- In scope:
  - setup CLI/contracts/service updates for channel selection and onboard aliasing
  - an Ink-based setup wizard for channel selection
  - assistant automation/state changes needed to auto-reply to configured channels
  - setup/docs/wrapper updates that explain the new onboarding flow
- Out of scope:
  - Telegram connector implementation
  - background launchd/service installation beyond the existing foreground `assistant run` process
  - changing canonical inbox triage semantics beyond making `assistant run --model` optional

## Risks and mitigations

1. Risk: auto-reply could answer historical backlog immediately after enablement.
   Mitigation: prime the auto-reply cursor on first run so only new messages after onboarding are handled.
2. Risk: setup and assistant runtime are already active work areas.
   Mitigation: keep the integration additive, preserve existing session/binding behavior, and stay within setup/onboarding plus assistant automation files.
3. Risk: interactive setup should not break JSON/agent/non-TTY flows.
   Mitigation: gate the wizard to human interactive TTY runs without explicit output-format overrides or dry-run mode.

## Tasks

1. Add setup channel contracts plus an Ink wizard and wire `onboard` and `setup` to the same onboarding flow.
2. Extend setup services to provision the iMessage source during onboarding and persist assistant auto-reply channel state.
3. Update assistant automation/state so configured iMessage captures can prime, open or continue assistant sessions, and deliver replies automatically.
4. Route post-setup handoff to `assistant run` when auto-reply is enabled, refresh docs/tests, and run validation as far as the environment allows.

## Verification

- Focused: setup CLI tests and assistant runtime tests covering wizard routing and auto-reply behavior.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
