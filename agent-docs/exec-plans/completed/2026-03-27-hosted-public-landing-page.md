# Hosted public landing page

Status: completed
Created: 2026-03-27
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

- Replace the hosted app root stub with a clean public landing page and optional SMS CTA wiring that points at the current verified signup entrypoint.

## Success criteria

- `apps/web/app/page.tsx` presents the public-facing positioning and signup CTA from the provided patch.
- A small helper resolves and validates `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER` without changing hosted onboarding auth behavior.
- Hosted web docs and env examples mention the optional public signup number.
- Focused tests cover the helper behavior.

## Scope

- In scope:
  - public root page copy/layout in `apps/web/app/page.tsx`
  - signup-phone helper + focused tests
  - hosted web README and `.env.example` updates
- Out of scope:
  - OTP or direct browser phone verification
  - passkey, billing, invite, webhook, or Cloudflare execution changes

## Constraints

- Preserve the existing `/join/*` onboarding path as the actual verified signup flow.
- Keep the change narrow because `apps/web` already has overlapping in-flight work.
- Run the repo-required verification commands plus the mandatory audit subagents if the workspace supports them.

## Tasks

1. Register the work in the coordination ledger.
2. Apply the provided landing-page patch to the current `apps/web` tree.
3. Add focused helper tests and verify the hosted web app path.
4. Run required repo checks, direct scenario proof, and mandatory audit subagents.

## Outcome

- Replaced the hosted root stub with the public landing-page copy and supporting layout updates in `apps/web`.
- Kept the verified signup path anchored on `/join/*` and avoided widening into onboarding/auth flow changes.
- Added focused hosted page coverage so the new public surface stays locked to the intended copy and CTA behavior.
