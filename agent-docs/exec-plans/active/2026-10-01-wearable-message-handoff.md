# Wearable test and messaging handoff

Status: active
Created: 2026-10-01
Updated: 2026-10-01

## Goal

After testing a wearable in the companion app, let the member message their assigned Murph contact and get a useful suggestion grounded in existing reminders.

## Success criteria

- Completed onboarding returns the same optional member-scoped contact route as pending onboarding.
- Missing contact context never blocks canonical onboarding completion.
- The assistant can handle an explicit test request without creating an unsolicited reminder or claiming physical delivery from a queued command.

## Scope

- Companion onboarding contact projection, focused contract tests, and a synthetic assistant journey.
- Native UI and Bluetooth ownership remain in the companion repository.
- No production deployment, physical haptic automation, or new scheduling system.

## Constraints

Reuse the existing authenticated projection and runtime tool boundaries. Keep contact data out of logs and fixtures synthetic.

## Risks and mitigations

- Optional contact reads can fail: preserve successful onboarding with a null action.
- A queued buzz does not prove vibration: inspect tool results and user-facing claims in the journey.

## Tasks

1. Extend the completed contact projection and its regression tests.
2. Verify the message handoff against real assistant execution with fake effect ports.
3. Update the contract owner, run focused checks, and complete review on the pushed head.

## Decisions

Use the existing optional contactAction field, with no new endpoint or recipient constant.

## Verification

Focused companion route tests, relevant typecheck, and the focused live assistant journey. Native simulator and phone evidence live with the companion change.

## Results

- Optional completed GET/POST contact projection and unavailable-context behavior pass eight focused route tests.
- Seven device-tool boundary tests pass. Web and assistant-engine typechecks, workspace build, and Web lint pass.
- Focused real assistant journey passes with the current default model via local subscription: one queued WHOOP buzz, actual reminder list/detail reads, a grounded timed-routine suggestion, and no reminder writes. Reply review: Ready.
- Native companion change has 320 passing focused tests and ten synthetic screenshots. Physical runtime messaging delivery remains unverified; no automated physical buzz was sent.
- Final external review and exact-head CI remain pending on the pushed candidate. No deployment is authorized or performed.
