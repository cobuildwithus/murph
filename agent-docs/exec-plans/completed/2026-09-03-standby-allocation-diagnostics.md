# Preserve standby allocation diagnostics

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Preserve the exact metadata-only reason and bounded timing for every accepted
  fresh standby allocation decision in the existing hosted ingress latency
  trace, with the same decision logged before later startup work.

## Success criteria

- Eligible fresh foreground starts distinguish a claimed slot, an empty ready
  pool, a coordinator deadline or failure, missing deployment bindings, and a
  post-claim bind failure without recording member or slot identifiers.
- The diagnostic reaches the existing Web-owned latency trace alongside the
  runtime invocation it describes.
- Standby admission, fallback, retry, and container ownership behavior remain
  unchanged.
- Focused contract and Cloudflare tests plus both owning typechecks pass.

## Scope

- In scope: additive hosted-runtime orchestration diagnostic fields; fresh
  allocation result attribution; focused parser, safety, and controller proof;
  owning runtime documentation.
- Out of scope: changing pool size, claim or bind deadlines, coordinator state,
  retry behavior, scheduling, container lifecycle, or deployment variables.

## Constraints

- Reuse the existing latency phase-breakdown path and enum-string safety rules.
- Record only bounded classifications, timestamps, and elapsed milliseconds;
  never persist claim ids, slot names, member ids, error text, or raw provider
  output.
- Add no database schema, network call, state owner, dependency, or synchronous
  logging callback.

## Risks and mitigations

1. Risk: diagnostics alter the hot start path.
   Mitigation: derive fields from already-awaited results and existing clock
   reads, then attach them to the already-propagated orchestration object.
2. Risk: enum drift causes Web to discard the whole phase breakdown.
   Mitigation: update the shared allowlist and parser tests in the same change.
3. Risk: a claimed slot leaks an operational identifier.
   Mitigation: expose only classification and elapsed time; keep slot and claim
   identities within the current Cloudflare owner.

## Tasks

1. Map every ready and fallback exit from fresh standby resolution.
2. Add the smallest diagnostic result shape and attach it to the accepted
   invocation's orchestration phase.
3. Add focused shared-contract and Cloudflare regression proof.
4. Update the owning reliability/runtime documentation and record the internal
   changelog decision.
5. Run focused tests, typechecks, complexity and diff checks, parent review,
   exact-head CI, and final ReviewGPT.

## Decisions

- Product UX effort: Patch. This changes only operator diagnostics; member
  behavior and timing contracts are unchanged.
- Persist in the existing Web-owned ingress trace because it already correlates
  direct admission with the accepted runtime attempt and is available through
  the documented read-only database path.
- Keep Worker structured logs as a secondary signal; they are not sufficient
  as the only diagnostic because local historical-log access may be unavailable.

## Verification

- Cloudflare standby allocation tests: 32 passed.
- Hosted-execution package tests: 54 files and 577 tests passed.
- Cloudflare and hosted-execution typechecks passed.
- `pnpm complexity:diff` and `git diff --check` passed.
- Final ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` with no findings for
  exact head `74068d11015bb58fe2dd8c1eb542dcf10d7ce82d`.
- Exact-head required CI owns broad repository proof after plan closure.

## Changelog

- Not applicable: this is internal operator diagnostic attribution with no
  member-visible behavior change.
Completed: 2026-09-03
