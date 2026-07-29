# Address-book four-alias cap

Status: completed
Created: 2026-07-28
Updated: 2026-07-29

## Goal

- Preserve a contact phone when more than two eligible unlinked Contacts cards
  disagree on its advisory label, subject to the existing combined-label
  bounds.
- Keep a deterministic sorted prefix of at most four distinct safe labels.

## Success criteria

- Web accepts one to four distinct safe advisory labels joined by ` / ` and
  rejects five or more.
- iOS case-folds and sorts distinct safe labels, then keeps the first four.
- Existing total label bounds, per-component safety, advisory-only authority,
  phone normalization, storage, and lookup behavior remain unchanged.
- Focused and canonical local verification pass in both repositories.

## Scope

- Current Web address-book parser, assistant advisory guidance, tests, security
  contract, and product spec.
- Counterpart iOS projection coalescing, tests, architecture, and product spec.

## Constraints

- No schema, migration, state owner, service, dependency, background work, or
  compatibility layer.
- Do not alter the existing canonical-phone or country-resolution behavior.
- Do not edit the completed plan for the earlier two-label implementation.

## Tasks

1. [x] Raise Web's accepted alternative count to four.
2. [x] Slice iOS's deterministic case-folded distinct-label list to four.
3. [x] Prove three, four, more-than-four, and mixed-case ordering behavior.
4. [x] Run product review, local deep review, and canonical verification.
5. [x] Prepare both existing PR branches and descriptions for the four-alias
   follow-up without rerunning ReviewGPT.

## Verification log

- Focused Web parser: 19 tests passed.
- Focused assistant group-tool contract: 63 tests passed.
- Focused iOS address-book sharing: 18 tests passed.
- Product review found and remediation covered case-sensitive prefix selection
  and incomplete-alternative guidance. No authority or privacy regression
  remained.
- Parent deep review found no unresolved correctness, privacy, authority, or
  architecture issue after the product-review remediation.
- Final `pnpm test:diff` completed every affected package test and typecheck,
  then waited ten continuous minutes for the shared host app-verification
  slot. The session was stopped under the documented bounded-admission rule.
- Exact staged-tree `pnpm verify:acceptance` completed successfully on the
  secret-free remote lane in 4m58s. The delegated one-shot runner stopped
  successfully after the command.
- iOS generated-project validation, format lint, 305 unit tests, and 16 UI
  tests passed locally (321 total).
- ReviewGPT was intentionally not rerun for this small follow-up at the user's
  direction. The current heads use local product and deep review instead.
Completed: 2026-07-29
