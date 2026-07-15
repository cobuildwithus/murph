# PR 677 Round-Six Portable Key ID

## Goal

Close the repeated parser-to-historical-root classification mechanism by
defining cipher-envelope key IDs once as closed portable identifiers. Reject
all control and nonportable characters at the canonical parser before lookup,
so deterministic persisted corruption cannot become a retryable outage or
withhold foreground reply authority.

## Retrospective Decision

- The trim-and-length rule was incomplete because it described two invalid
  examples instead of the complete accepted language.
- Every production producer emits an ASCII token: domain roots use `udrk`, data
  keys use `hdk`, and browser replica keys derive from a hexadecimal version.
- Replace the partial branches with one canonical 1–256 character portable-token
  grammar. Keep the envelope parser/writer as the sole validity owner.
- Add no reader heuristic, status mapping, state owner, retry counter, queue,
  service, repair path, lifecycle, reconciliation loop, or compatibility layer.

## Working Set

- `packages/runtime-state/src/hosted-storage.ts`
- `packages/runtime-state/test/hosted-storage.test.ts`
- `apps/cloudflare/test/crypto.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`

## Verification Plan

- Prove embedded NUL and representative control/nonportable values fail the
  canonical parser and writer.
- Prove the encrypted R2 reader never calls historical lookup for those IDs.
- Prove the real runner artifact route returns terminal 422 for an embedded-NUL
  stored key ID and retain existing downstream foreground-admission proof.
- Run focused tests, required coverage audit, `pnpm test:diff`, scenario
  integrity, privacy/diff checks, CI, and correction verification.

## Outcome

- Replaced example-by-example whitespace/length checks with one closed portable
  identifier grammar at the shared envelope parser and writer boundary.
- Embedded control characters and nonportable characters now become terminal
  unreadable-artifact failures before any historical-key lookup.
- Coverage proves accepted grammar boundaries, parser and writer rejection,
  resolver exclusion, and the real runner route's terminal 422 response.
- Required coverage-write audit, focused tests, affected typechecks/tests/app
  verification, scenario integrity, diff checks, and privacy scan passed.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
