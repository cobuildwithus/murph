# Simplify group newsletter delivery

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Make a scheduled group health newsletter deliver either to the current
  iMessage/Telegram conversation or to the consented group email thread, while
  reusing the existing automation, conversation reply, and email delivery
  owners.
- Close the setup and composition gaps that allowed a saved newsletter to omit
  its execution contract and produce a low-quality census-style edition.

## Success criteria

- Chat delivery uses the ordinary scheduled assistant response and current
  conversation route; it does not create a newsletter-specific chat sender.
- Email delivery alone uses the existing newsletter recipient-resolution and
  one-shot send boundary.
- New newsletter setup persists an unambiguous delivery choice and every input
  required for deterministic scheduled execution.
- Scheduled composition reliably receives the current newsletter content
  contract without depending on an optional shell skill read.
- Existing email newsletter records remain readable or fail with a clear repair
  path; unrelated automations and delivery channels are unchanged.

## Scope

- In scope: group-newsletter setup guidance, hosted automation validation and
  scheduled prompt construction, existing newsletter tool authority, focused
  owner tests, and the current product/runtime documentation.
- Out of scope: a new scheduler, queue, delivery service, database table,
  recipient store, generic multi-channel campaign system, or changes to consent
  and verified-email ownership.

## Constraints

- Keep the canonical automation record as schedule/config owner.
- Keep Web as the current email recipient/authorization owner and the ordinary
  messaging outbox as the iMessage/Telegram delivery owner.
- Do not infer channel authority from model-supplied route identifiers.
- Prefer validation, canonical prompt construction, and deletion of duplicate
  conventions over new persisted state or abstractions.

## Risks and mitigations

1. Risk: a free-form instruction string can drift from the executable contract.
   Mitigation: trace and centralize the smallest machine-owned newsletter
   contract at the existing automation boundary, with focused rejection tests.
2. Risk: email capability leaks into a chat-delivery newsletter.
   Mitigation: derive capability from the validated newsletter delivery choice
   and keep current-route messaging on the normal response path.
3. Risk: changing the historical newsletter slug breaks active records.
   Mitigation: inspect persisted/runtime compatibility before choosing a shape,
   retain a narrow reader only if current records require it, and provide an
   explicit repair result rather than silent fallback.
4. Risk: channel/runtime deploy skew changes delivery behavior.
   Mitigation: preserve existing effect owners and document any required deploy
   order after the final owner diff is known.

## Tasks

1. Trace setup, automation persistence, scheduled prompt construction,
   capability planning, stats preparation, and final channel delivery.
2. Select the smallest representation that distinguishes current-chat and
   consented-email delivery without creating another owner.
3. Implement validation and deterministic scheduled composition, deleting or
   narrowing redundant prompt-only machinery where possible.
4. Add setup-to-scheduled-execution coverage for iMessage/Telegram chat and
   group email, including malformed and legacy records.
5. Update durable contracts, run scoped and full verification, complete the
   required audits, and finish through PR CI and ReviewGPT.

## Decisions

- Chat newsletters are ordinary scheduled conversation replies; only email
  needs the specialized newsletter sender.
- No new durable service, table, queue, scheduler, or transport abstraction is
  justified by the current requirement.
- One structured `save_newsletter` action writes the stable slug, canonical
  configuration text, current authenticated group route, and exactly one
  system-owned delivery tag. Generic saves cannot target that record and
  newsletter patches are status-only.
- A tagless legacy newsletter remains email-delivered until it is re-saved;
  ambiguous records with both delivery tags fail closed to current-chat
  delivery so they cannot gain email authority.
- Every newsletter occurrence appends the current machine-owned composition
  and delivery contract. Existing free-form instructions remain configuration
  context but cannot preserve retired actions or model-supplied group routing.
- Current-chat delivery accepts at most three scopes, uses one ordinary
  `read_shared` call, and receives no newsletter email tool. Email preparation
  derives its group from the signed runtime member while accepting and ignoring
  the old optional wire `groupId` only during the Web-first rollout window.

## Verification

- Focused assistant-engine, assistant-runtime, hosted-execution, and Web owner
  tests pass for both delivery modes, legacy records, malformed state, route
  rebinding, email-capability isolation, and the content contract.
- A required coverage-write audit found one generic retarget path; the final
  boundary makes newsletter patch status-only and requires a structured re-save
  from the destination group for configuration or route changes.
- A final parent review found and closed effective-slug, stale wire-schema,
  current-chat email-capability, and new-group permission gaps with focused
  regressions.
- The fresh worktree's missing `@murphai/assistant-runtime/dist` prerequisite
  initially stopped the reverse-dependent hosted-local harness before any
  newsletter assertion. After building that required artifact, the exact
  harness passed with 406 tests and one skip.
- Final serialized `pnpm test:diff` passed all affected guards, typechecks,
  package suites, hosted-local coverage, Web production verification, and
  Cloudflare verification in 747 seconds. Finish with `git diff --check`, PR
  CI, and exact-head ReviewGPT.
Completed: 2026-07-20
