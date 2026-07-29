# Address-book conflicting aliases

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Preserve useful owner contact labels when multiple unlinked Contacts cards
  attach different safe names to the same canonical phone number.
- Represent the uncertainty honestly as two explicit alternatives instead of
  dropping the phone or selecting one arbitrary identity.

## Success criteria

- Web accepts either one existing safe advisory label or exactly two distinct
  safe labels joined by ` / `.
- iOS deterministically emits the two-label form for a canonical phone with
  exactly two distinct eligible labels.
- More than two distinct labels, unsafe labels, and oversized combined labels
  remain omitted.
- Existing one-label clients, storage, lookup, authorization, encryption, and
  group-roster behavior remain unchanged.
- Backend-first deployment keeps old clients and the new iOS producer
  compatible throughout rollout.
- Focused tests, canonical verification, product review, ReviewGPT gates, CI,
  and mergeability complete with no unresolved accepted finding.

## Scope

- Hosted Web address-book request validation and focused tests.
- Current address-book privacy/security product documentation.
- Counterpart iOS projection coalescing, focused tests, and current iOS
  address-book documentation in its own repository and PR.

## Constraints

- No schema, migration, persisted state, new endpoint, background process, or
  dependency.
- Do not infer that one conflicting card is more authoritative than another.
- Cap the explicit alias set at two and retain the existing total label bounds.
- Keep each component inside the existing safe first-name plus optional
  last-initial grammar.

## Evidence

- A production-device projection worked for one group participant but not
  another.
- The local synced Contacts store contains three cards for the missed canonical
  phone; two cards pass projection safety and produce two distinct labels.
- The current iOS projector discards the entire phone whenever its eligible
  label set has cardinality other than one.
- The current Web parser accepts only one safe label, so backend acceptance must
  deploy before iOS can emit an explicit alternative pair.

## Tasks

1. [x] Extend Web validation to one label or one exact two-label alternative.
2. [x] Add focused parser and lifecycle proof and update current security/spec
   language.
3. [x] Implement deterministic iOS coalescing and focused projection tests.
4. [x] Run local verification and direct contract checks in both repositories.
5. [ ] Complete product-experience review, preliminary ReviewGPT specialist
   coverage review, parent final review, and final ReviewGPT gates.
6. [ ] Prove CI, mergeability, backend-first rollout order, and the physical
   phone retest path.

## Verification log

- The focused Web address-book projection suite passed 18 tests.
- Full Web acceptance passed, including typecheck, lint, build, app tests, and
  owner-level coverage.
- The focused iOS address-book suite passed 18 tests.
- The full iOS simulator suite passed 305 unit tests and the complete UI test
  run; SwiftFormat lint passed for the repository.
- A private aggregate-only check of the affected local Contacts data confirmed
  three cards for one canonical phone and exactly two distinct eligible labels.
  No contact values or direct identifiers were printed or persisted.
- The deployment contract is backend first: existing clients remain accepted,
  then the new iOS producer may emit the explicit alternative form.
- Product-experience review passed with no findings: the explicit separator
  preserves uncertainty without adding a prompt, setting, or user choice.
