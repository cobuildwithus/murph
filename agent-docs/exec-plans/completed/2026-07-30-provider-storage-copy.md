# Clarify Provider Storage Copy

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make the provider picker explain both providers' storage posture in short,
  parallel language without turning `store: false` into a zero-data-retention
  promise.

## Success Criteria

- OpenAI uses the plain-language line "No chat history saved."
- Venice uses the compact positioning line "Privacy-first inference."
- The dialog introduction says Murph uses the selected provider after save
  without limiting the statement to core replies.
- The durable product and security docs bound the OpenAI statement to Responses
  API application-state storage and preserve the existing Venice boundary.
- The focused component test and design-catalog study cover the final copy.
- Desktop and mobile browser proof show that both descriptions remain easy to
  scan.

## Scope

- Provider-picker copy, its focused component test, the existing design-catalog
  study, and the matching product/security disclosures.
- No provider routing, request construction, persistence, availability,
  billing, or tool-provider behavior changes.

## Verification

- Focused hosted assistant model settings test.
- Scoped web typecheck and lint.
- Desktop and mobile design-catalog browser proof.
- The user explicitly waived additional review gates and requested direct
  merge after the focused verification.

## Completion Evidence

- Focused hosted assistant model settings test: 18 tests passed.
- Scoped ESLint passed for the component, focused test, and design-catalog
  study.
- Web typecheck passed.
- Desktop and mobile Playwright checks confirmed the final strings and dialog
  containment.
Completed: 2026-07-30
