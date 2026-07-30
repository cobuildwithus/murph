# Clarify Provider Storage Copy

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make the provider picker explain both providers' storage posture in short,
  parallel language without turning `store: false` into a zero-data-retention
  promise.

## Success Criteria

- OpenAI says Murph disables response storage.
- Venice says prompts and replies are not stored in fewer words than the
  current description.
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
- Required product-experience, frontend, coverage, Claude UI, parent, CI, and
  ReviewGPT gates.

