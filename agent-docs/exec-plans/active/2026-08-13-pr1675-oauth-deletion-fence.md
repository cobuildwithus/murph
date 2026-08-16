# PR 1675 provider setup completion fences

Status: active
Created: 2026-08-13
Updated: 2026-08-15

## Goal

Ship the member-owned Strava provider setup with the deletion-first revision:
ordinary model-driven browsing plus one deterministic credential boundary,
replacing the adversarial trusted-submit design and every fence, name, and
absence-proof subsystem that existed only for it.

## Decision: ordinary browsing with a deterministic credential boundary

The assistant is trusted to navigate the provider dashboard, identify the correct
page, fill the complete private-application form, choose an ordinary non-personal
application name, submit the form, and recover from visible validation or
duplicate-application errors. Strava permits one application per account, so an
existing application is handled from the live page rather than through a second
application-identity subsystem.

The finite provider registration supplies:

- the developer-portal and credentials-page URL;
- the required website, category, callback URL, and read-only scopes;
- one registered client-ID selector;
- one registered client-secret selector;
- an optional registered secret-reveal selector.

The model uses the existing setup-owned browser run with ordinary computer-use
actions and observations. Sign-in, MFA, CAPTCHA, and provider prerequisites still
pause and resume that exact run through the existing handoff. The model must never
ask the member for provider credentials, read or transcribe credential values, or
click the secret-reveal control.

When the credentials page and both credential elements are present, the model
calls `provider_setup capture` once. Trusted deterministic code navigates to the
registered credentials URL, verifies exact origin and path, optionally clicks the
registered reveal control, requires each registered credential selector to
resolve to exactly one visible element, reads and seals both values through the
existing KMS-backed provider-application store, scrubs browser-side values, and
returns no credentials. Capture is read-only apart from reveal and is safely
retryable.

`DeviceProviderSetup` retains one simple in-progress browser state plus its
optimistic version. Cancellation before successful capture is safe because the
trusted boundary no longer owns provider submission. Browser provisioning
`cleanup_pending`, exact-run handoff ownership, mailbox continuation, wake
recovery, and terminal run release remain unchanged; provider-submit ambiguity
does not create a second recovery state machine.

Deletion navigates to the registered credentials page and reads the on-page
client ID through the registered selector inside trusted code. Trusted code
compares that value exactly with the sealed client ID before clicking the
live-page delete and optional confirmation controls. A cleanly loaded credentials
page with no client-ID element means the application is already absent. A
mismatch, duplicate or hidden client-ID element, redirect, partial page, or
uncertain post-delete state fails closed and retains the encrypted local binding.

The unmerged friendly-name migration and schema column are removed. No new state
owner, queue, scheduler, provider adapter, browser DSL, or provider-specific
browser program is introduced.

## Acceptance

- Setup-owned runs accept ordinary computer-use actions and observations while
  preserving exact setup ownership, handoff, and cleanup binding.
- The model fills and submits all ordinary application metadata, including the
  application name.
- Capture accepts no model-supplied selectors or credential values.
- Registered capture selectors must each resolve to exactly one visible element.
- Client ID and client secret are sealed and scrubbed without entering model,
  logs, UI, tool results, workspace state, or durable setup state.
- Capture can be retried after a browser or transport interruption without a
  provider-side write.
- Cancellation may win a concurrent capture through the existing setup version.
- Deletion clicks nothing until the registered on-page client ID exactly matches
  the sealed client ID.
- A clean page with no client-ID element converges as already absent; every
  ambiguous deletion state fails closed.
- The `application_name` column, friendly-name migration, `capturing` status, and
  machinery and tests that exist only for those contracts are deleted.
