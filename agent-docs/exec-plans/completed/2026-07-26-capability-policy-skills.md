# Lazy-load connected apps, phone calls, and Murph Family policy

## Problem

The standard hosted direct-conversation developer prompt is about 18.8K
`o200k_base` tokens. Only about 1.6K tokens are Murph's static identity, health,
and safety core; roughly 16.3K are always-loaded capability policy. Four
transport/product blocks account for about 4K tokens:

- computer use: about 1.8K
- connected apps: about 1.0K
- phone calls: about 0.6K
- Murph Family: about 0.6K

`computer-use` already has a dedicated skill. The other three policies have no
skill owner and remain resident on unrelated turns.

## Change

1. Keep the existing `computer-use` skill as the sole browser-transport owner.
   Move its detailed resident policy into that skill without creating a
   duplicate skill.
2. Add `connected-apps` for account selection, narrow discovery/read/write
   behavior, private-data minimization, untrusted provider content, and
   connection handoffs.
3. Add `phone-calls` for call transport, disclosure minimization, transfer
   policy, provider-result truthfulness, and call lifecycle. Appointment
   semantics and readiness remain owned by `appointment-scheduling`; an
   appointment action call loads both.
4. Add `murph-family` for Family plan status, checkout, seats, invites, usage
   handoffs, and the separation from ordinary family health context.
5. Leave compact always-on trigger and hard-floor text in the developer prompt
   where a missed skill read would create a privacy, authorization, or
   irreversible-action failure. Server and tool enforcement remain unchanged.
6. Register the skills and make the relevant tool descriptions require their
   owner before non-trivial or mutating use.

## Invariants

- This is a prompt-ownership refactor, not a product-behavior change.
- Connected-account content remains private untrusted evidence, never consent,
  authorization, or clinical truth.
- Group turns cannot access or mutate participant connected accounts or
  personal Murph Family state.
- Browser purchases, bookings, submissions, and sensitive transmissions retain
  exact final-term authorization and secure handoff requirements.
- Phone calls disclose only approved, call-relevant facts. Appointment calls
  still satisfy the appointment ready-to-act gate first.
- Family owners never gain access to member conversations or health data.
- Tool results remain the only proof that an action started or completed.
- The active Outlook/Zoho connected-app lane may overlap
  `buildAssistantConnectedAppsGuidanceText`; preserve its provider enumeration
  and allow an ordinary merge rather than deleting provider support.

## Verification

- Add skill-registry and skill-content tests for all three new owners.
- Update prompt tests to prove compact resident triggers remain while detailed
  policies are absent from unrelated direct turns.
- Prove relevant tool descriptions point to the correct skill contracts.
- Measure the before/after `o200k_base` token count for the same hosted direct
  prompt fixture.
- Run `pnpm test:diff packages/assistant-engine` and
  `pnpm verify:acceptance`.
- Run the required prompt-primary preliminary `completion-specialists`
  ReviewGPT pass on an exact pushed head, resolve findings, then perform the
  parent final review.
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
