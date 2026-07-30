# Log Launch Consent Declines

Status: completed
Created: 2026-07-30

## Goal

- Persist a privacy-safe consent audit event when an authenticated person
  declines the launch consent prompt.
- Preserve the existing terminal sign-out behavior even if the scoped audit
  write is temporarily unavailable.

## Success criteria

- Each currently ungranted launch scope receives a durable `declined` consent
  event tied to the authenticated member and current document versions.
- Retrying the same browser-session decline does not create duplicate events.
- The decline endpoint remains same-origin protected, accepts no member or
  scope authority from the browser, and clears the app session independently
  of the scoped audit write.
- The consent-specific session revoke reason preserves a coarse durable refusal
  fact when scoped audit storage is unavailable.
- Focused service, route, client, and interaction tests pass together with the
  scoped typecheck and required PR review gates.

## Constraints

- Store no phone number, contact detail, document content, or free-form browser
  metadata.
- Reuse `HostedConsentEvent`; do not add a schema, telemetry service, or second
  consent owner.
- Derive pending launch scopes and document versions on the server.
- Preserve the existing consent prompt and its explicit decline recovery.

## Working set

- `apps/web/src/lib/legal/consent.ts`
- `apps/web/app/api/legal/consent/decline/route.ts`
- `apps/web/src/components/hosted-onboarding/hosted-app-session-client.ts`
- `apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx`
- Focused consent, route, client, and auth-panel tests

## Verification plan

- Focused Vitest over the consent service, consent routes, app-session client,
  and auth-panel interaction.
- Scoped `apps/web` typecheck.
- Direct route scenario proving server-derived scopes, idempotent recording,
  and consent-specific session revocation.
- Preliminary ReviewGPT coverage/frontend lenses, local product-experience
  review, parent final review, final ReviewGPT, and exact-head CI.
Updated: 2026-07-30
Completed: 2026-07-30
