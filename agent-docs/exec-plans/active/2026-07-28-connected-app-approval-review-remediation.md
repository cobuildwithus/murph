# Connected-app approval final-review remediation

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Resolve the accepted final ReviewGPT findings on draft PR 1028 without
  weakening the existing exact, single-consumer approval boundary.
- Encrypt member-facing connected-app approval presentation at rest.
- Make the approved connected-app values the same bounded values sent to the
  provider, with unambiguous account presentation.

## Proven gaps

1. Connected-app approval titles and bodies are stored in plaintext in
   `hosted_sensitive_action_challenge`, despite containing provider-derived
   account and calendar details.
2. The current preview cleans and truncates provider-bound strings while the
   provider receives the originals, so the approved display can differ from
   the executed mutation.
3. Accounts with the same alias can render indistinguishably even though the
   exact hidden account ids differ.

## Scope

- Hosted action-approval presentation storage, schema, migration, and focused
  persistence tests.
- Connected-app mutation preparation, provider execution, and focused
  approval/service tests.
- Current security and architecture documentation when the encrypted field
  ownership or executable-value invariant needs durable clarification.
- No new state owner, queue, dependency, background execution, or approval
  replay path.

## Invariants

- Legacy approval records keep their current plaintext storage and behavior.
- Connected-app approval records use only member-bound encrypted presentation;
  old plaintext connected-app approvals are invalidated during migration.
- Presentation decrypts only for the authenticated member and fails closed for
  missing, corrupt, or context-swapped ciphertext.
- Every provider-bound connected-app mutation value is validated before
  approval, used unchanged in presentation and identity, and executed from the
  same prepared representation.
- Control characters, directional controls, the fact-row separator, unpaired
  surrogates, and overlong values are rejected rather than rewritten.
- Account presentation always includes toolkit, alias, and word id; a stable
  account-id fingerprint is added only when word id does not disambiguate.
- Exact approval consumption remains immediately before the provider mutation.

## Tasks

1. [ ] Add encrypted connected-app presentation storage and owner-bound
   decrypt-on-render behavior.
2. [ ] Add one canonical mutation preparation path shared by approval and
   provider execution.
3. [ ] Add migration, persistence, hostile-value, ambiguity, and execution
   regressions.
4. [ ] Run focused checks, preliminary specialist review for the remediation
   delta, canonical verification, and acceptance.
5. [ ] Close the plan with a scoped commit, push the draft PR, then run the
   immutable-baseline final ReviewGPT remediation round and CI.

## Verification

- Focused Web approval, connected-app builder/service, migration, and database
  tests plus Web typecheck.
- `pnpm test:diff packages/hosted-execution packages/assistant-engine apps/web`
- `pnpm verify:acceptance`
- Preliminary `completion-specialists` ReviewGPT pass on the exact pushed head,
  followed by parent review.
- Final ReviewGPT remediation round for PR 1028 and green PR CI.
