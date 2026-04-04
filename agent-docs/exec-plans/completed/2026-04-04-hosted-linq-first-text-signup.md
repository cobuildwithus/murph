# Hosted Linq First-Text Signup

## Goal

Make the hosted signup number send back a Murph invite link on the first inbound Linq/iMessage text so the operator can give users one number to text and reliably get them into signup.

## Scope

- Remove the first-contact requirement for a special onboarding trigger phrase in the hosted Linq webhook flow.
- Make first-contact replies send the invite link immediately instead of a separate "get started" prompt.
- Update focused tests and any hosted reply copy needed to match the production onboarding flow.

## Constraints

- Reuse the existing hosted onboarding, invite, receipt, and Linq side-effect pipeline instead of adding a second ingress path.
- Keep the change scoped to hosted Linq onboarding behavior; do not widen into Stripe, Privy, or hosted execution refactors.
- Preserve unrelated in-flight work in `apps/web`.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- In progress
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
