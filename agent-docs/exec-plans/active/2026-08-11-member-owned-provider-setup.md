# Member-owned provider setup and Strava activation

Status: active
Created: 2026-08-11

## Goal

- Let a member ask Murph to connect a provider and complete the provider-owned
  application setup without copying credentials or navigating a developer
  dashboard manually.
- Establish one reusable member-owned provider setup journey, with Strava as
  the first finite adapter and production-shaped proof case.
- Ship the complete remaining connection journey in one PR: setup, user login
  handoff when required, exact OAuth completion, initial sync, status/recovery,
  polling-first operation, and contextual entry from Murph and `/connect`.

## Product Contract

- The normal entry point is conversational: a member asks Murph to connect a
  supported provider and receives one first-party handoff when human login,
  MFA, CAPTCHA, or consent is required.
- Murph owns developer-application creation or recovery, callback setup,
  credential capture, immediate sealing, OAuth continuation, and progress.
  The member never copies, sees again, or submits a client secret to Murph UI.
- Shared setup, secret sealing, OAuth-state binding, recovery, progress, and
  connection activation stay provider-neutral. Provider dashboard selectors,
  marker rules, OAuth details, and polling behavior remain in a finite adapter.
- Do not introduce a generic browser DSL, new scheduler, second OAuth owner,
  or speculative multi-provider machinery. The abstraction must be justified
  by the Strava adapter and the next provider's clear extension point.

## Invariants

- Web remains the authority for member ownership, encrypted provider
  applications, exact application revision, OAuth state, connection binding,
  connection status, and deletion.
- Plaintext provider secrets never enter prompts, model-visible browser text,
  tool results, browser responses, logs, screenshots, fixtures, workspace
  state, assistant runtime state, or durable unencrypted storage.
- Browser automation runs through the existing hosted-computer owner and
  persistent profile. Human handoff is limited to provider login, MFA,
  CAPTCHA, and consent; Murph never serializes those sensitive values.
- Retry and recovery distinguish known-unsent, provider-owned in-progress,
  ambiguous, repairable application state, and transient Web/KMS failure.
  Replacement cannot overlap an active bound connection.
- Strava uses scheduled reconciliation by default. Webhook activation remains
  disabled unless a private, per-application authenticity contract is proven.
- Account deletion, consent withdrawal, disconnect, and provider-app cleanup
  remain monotonic and preserve their existing exact owners.

## Scope

- In scope: reusable setup contract and adapter seam, Strava dashboard
  automation, hosted-computer integration, intent/status/recovery APIs,
  conversational tool/prompt entry, `/connect` progress and repair UX,
  design-catalog component and section studies, polling activation, fake
  provider and production-shaped E2E coverage, docs, and changelog.
- Out of scope: additional provider adapters, generic browser scripting,
  provider-global credentials as fallback, shared Strava webhooks without
  private authenticity, storing approval correspondence, or unrelated device
  sync and computer-use refactors.

## Plan

1. [x] Send the exact current baseline plus original proposal context to
   ReviewGPT and obtain a complete implementation patch.
2. [x] Inspect the patch for scope, privacy, ownership, and simplicity; apply
   it deliberately and resolve any integration defects without widening the
   architecture.
3. [x] Run focused unit, integration, migration, type, lint, and
   production-shaped fake-provider proof across every changed owner.
4. [x] Render every changed state from the real design-catalog component and
   section at desktop and mobile widths; complete the required UI double-check.
5. [ ] Commit and push the candidate, open PR 2, and run preliminary
   specialists plus final ReviewGPT round 1 concurrently with exact-head CI.
6. [ ] Resolve every accepted finding through ReviewGPT-authored remediation,
   repeat focused proof and the final loop until `ROUND_OUTCOME: PASS`, then
   complete parent review, plan closure, merge-tree proof, and merge-readiness
   handoff without merging PR 2.

## Verification

- Focused tests for the provider-neutral setup contract and Strava adapter,
  exact application/revision binding, secret non-observability, browser
  ownership and handoff recovery, OAuth continuation, polling, disconnect,
  deletion, and contextual entry.
- Production-shaped hosted-local E2E using a deterministic fake provider and
  fake developer dashboard. Real Strava proof is operator-owned and may use
  only a disposable approved account with no secret-bearing artifacts.
- Changed-owner typechecks, Web lint, migration/schema validation, design proof,
  and exact-head GitHub Actions.
- Preliminary product-experience, prompt, frontend, and coverage ReviewGPT
  lenses; Claude Code UI double-check; final sensitive ReviewGPT loop; parent
  final diff/call-path review; current-base merge-tree proof.

## Notes

- The product owner confirmed Strava permission for this flow. The repository
  records only the implementation boundary, not private correspondence.
- PR 1484 is merged and supplies the encrypted, revisioned, Web-owned provider
  application foundation. This PR must extend that owner instead of creating a
  parallel credential or connection system.
