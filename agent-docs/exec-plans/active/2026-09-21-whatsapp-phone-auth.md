# WhatsApp phone verification with SMS fallback

Status: paused at user request; Meta Business account not yet set up
Created: 2026-09-21
Updated: 2026-09-21

## Goal

Offer WhatsApp as the default phone signup/login code delivery in configured
calling-code regions on web, iOS and Android, with an explicit text alternative.
Preserve phone identity, existing verification ownership and shared attempt limits.

## Architecture and evidence

The hosted Twilio Verify adapter currently hard-codes SMS for send and check.
Browser and native OTP routes already share admission and encrypted challenge
ownership. Extend these owners with a closed delivery choice; do not add another
challenge, database table, provider integration, persisted preference or fallback
queue. Twilio owns code generation and channel fallback. Verification remains
bound to the same account, service, phone and verification SID.

A server-configured calling-code list supplies the default on every client.
An empty list disables WhatsApp. Public options expose only that list, without
contacts, database work or provider calls. Explicit requests are validated by
server policy before challenge replacement or provider work. Old clients omit
the choice and continue using SMS. Settings credential proof remains SMS.

## Product UX

- Outcome: A person can request a code through WhatsApp or text and finish the
  existing signup/login journey.
- Entry and promise: Phone entry offers the configured default and a smaller
  text alternative. Code entry names where to look, permits text recovery and
  resends the last chosen channel. No additional chooser screen.
- Affected journeys: configured/other calling codes; explicit international
  paste; signup/login/invites; SMS override; WhatsApp send failure; resend;
  verify failure; change destination; unavailable options; old native clients;
  email and settings proof regressions; narrow and desktop presentation.
- Proof: provider contract tests, admission/composed challenge tests, browser
  interactions and rendering, native unit/build tests and simulator/emulator
  captures. Live provider delivery remains a rollout prerequisite.
- Done when: all three client PRs preserve the intended path, focused proof and
  required CI pass, and each required ReviewGPT loop is resolved.

## Setup and rollout plan

The user paused implementation because a Meta Business account is not yet set
up. Only this plan and its index entry are committed and pushed; no feature PR,
deployment, account provisioning or provider send is authorized by this pause.

Before enabling WhatsApp:

1. Set up the Meta Business portfolio and WhatsApp Business account through the
   current Twilio onboarding process. Register and qualify the intended sender;
   complete the verification and authentication-template steps required by that
   process. Existing SMS credentials alone do not establish WhatsApp readiness.
2. Connect the sender's Messaging Service to the existing Twilio Verify service
   following [Twilio's sender setup](https://www.twilio.com/docs/verify/whatsapp/byo)
   and [Verify WhatsApp documentation](https://www.twilio.com/docs/verify/whatsapp).
   Recheck the current provider requirements when resuming.
3. Confirm the initial supported destinations. Brazil (+55), India (+91),
   Indonesia (+62), and Germany (+49) are proposed starting candidates, not an
   approved rollout list. Calling codes provide a default preference only;
   they cannot establish whether an individual uses WhatsApp. Shared calling
   codes must be considered before enabling a whole prefix.
4. Resume implementation and review. Deploy backward-compatible backend support
   before dependent native releases. Keep `HOSTED_AUTH_WHATSAPP_CALLING_CODES`
   empty until sender setup and delivery qualification are complete. Missing or
   invalid options must leave all clients on SMS.
5. With explicit authorization, qualify real WhatsApp delivery, deliberate SMS
   recovery and code verification on controlled test destinations. Enable a
   small approved list and inspect delivery and completion outcomes before
   expanding it.

Use the existing Verify account, service and challenge; request the WhatsApp
channel explicitly. Accept a valid provider SMS fallback and explain it on the
code screen. Verify accepts both supported channels independently of current
send policy so turning off new WhatsApp sends does not discard a pending code.
No production configuration or secret has been changed.

## Tasks

1. Extend the existing hosted Verify and OTP admission boundaries.
2. Add one public channel-options response and compose web controls.
3. Add matching iOS and Android changes in isolated branches and linked PRs.
4. Run focused tests, typechecks/builds and inspect rendered evidence.
5. Review complexity/privacy, commit, open PRs and run ReviewGPT alongside CI.
6. Close the plan and verify final heads, required checks and mergeability.

## Paused implementation handoff

Uncommitted drafts are preserved in isolated `feat/whatsapp-phone-auth` branches
in the Murph, murph-ios and murph-android repositories. Locate them through each
repository's worktree list; no local machine paths belong in this plan. No native
commits or PRs have been created. Review the drafts before resuming: they are
incomplete and are not a release candidate.

- Backend/web draft: optional closed `sms`/`whatsapp` choice through existing
  admission and Verify owners; server options shared by browser and native
  endpoints; WhatsApp primary action and text recovery using current controls.
- iOS draft: options fetch, channel-aware send/resend and existing login UI
  changes, with focused model tests added.
- Android draft: the same changes through hosted auth, login coordinator and
  existing Compose controls, with focused coordinator tests added.
- Preserve old-client SMS behavior, email flows, consent, session bootstrap,
  settings proof and provider/account/service/phone/SID binding checks.

## Verification at pause

- Passed: 77 focused web tests covering phone options, contact-code interaction,
  login, credential interaction, Twilio Verify and request admission.
- Passed: `pnpm --dir apps/web typecheck`.
- iOS formatting and project generation completed; native compilation and tests
  have not run. A dedicated test simulator was created but not booted.
- Android focused tests could not start because the Android SDK location was
  unavailable. Configure an existing valid SDK before retrying; no Android
  compilation or test result is claimed.
- Still required: composed database challenge/channel-switch proof, native
  HTTP and model verification, rendered web/simulator/emulator evidence,
  deployment documentation, final privacy/complexity review, linked feature
  PRs, required CI and ReviewGPT loops. No live delivery was tested.

Resume only when the user requests it. Reconfirm sender readiness and rollout
scope, inspect preserved diffs and update against current repository guidance
before continuing the implementation checklist.
