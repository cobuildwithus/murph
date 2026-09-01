# Preserve hosted E2E startup failure classification

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Make hosted-local E2E startup recover from a transient Worker port bind race
  through its existing bounded retry, even when another child emits enough
  startup output to exceed the aggregate diagnostic tail.

## Success criteria

- The failing child's bounded, redacted output remains present in the startup
  error inspected by the current retry classifier.
- A focused regression proves a Cloudflare `EADDRINUSE` line cannot be displaced
  by verbose Temporal output.
- Non-port startup failures remain non-retryable.
- Focused tests, package typecheck/boundary verification, and required PR gates
  pass on the exact pushed head.

## Scope

- In scope: hosted-local startup diagnostics and the existing full-stack E2E
  retry boundary.
- Out of scope: new retry owners, CI-level job retries, production Worker
  behavior, port-manager services, or changes to scenario semantics.

## Constraints

- Technical constraints: preserve redaction, bounded diagnostics, exact child
  process ownership, and the current three-attempt limit.
- Product/process constraints: keep the fix local to the current hosted-local
  lifecycle owner and preserve all user-critical hosted behavior.

## Risks and mitigations

1. Risk: retaining more per-child output could make startup errors unbounded
   or expose unnecessary diagnostic content.
   Mitigation: inspect only the already bounded, redacted buffer for the exact
   exited child and emit one fixed classification instead of copying raw output.
2. Risk: broader text matching could retry unrelated failures.
   Mitigation: preserve the current closed port-collision signatures and the
   existing scenario-owned attempt limit; non-port failures remain unchanged.

## Tasks

1. Add a failing regression for verbose sibling output displacing the exited
   Cloudflare child's address-in-use diagnostic.
2. Preserve the port-collision classification from the exact exited child in
   the primary startup error before aggregate diagnostics are truncated.
3. Run focused hosted-local harness and full-stack helper tests, then package
   typecheck/boundary verification.
4. Inspect and commit the scoped diff, open the PR, and complete exact-head CI
   and required review gates.

## Decisions

- Keep the existing scenario-owned bounded retry; do not add workflow reruns or
  a second port-allocation owner.
- Fix information loss at the hosted-local stack diagnostic boundary where the
  child output is already owned and redacted.
- Accept ReviewGPT round 1's production-faithfulness finding: the generic child
  `Text` readers still inherited the 2,000-character diagnostic-tail default.
  Preserve the existing 2,000,000-character buffer as the full-text bound and
  keep the tail readers unchanged.

## Verification

- Completed local proof:
  - `pnpm exec vitest run --config packages/hosted-local-harness/vitest.config.ts --no-coverage packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.test.ts`
  - `pnpm --dir packages/hosted-local-harness typecheck`
  - `pnpm --dir packages/hosted-local-harness verify:package-boundary`
  - `pnpm --dir packages/hosted-local-harness test:coverage`
  - `pnpm complexity:diff`
- Outcomes: the new regression failed before the implementation and passed
  afterward; the complete focused stack and scenario-helper files passed; all
  449 harness tests passed with coverage; typecheck and package-boundary proof
  passed; and complexity debt did not increase.
- Review remediation proof: a real spawned child now proves the diagnostic tail
  omits an early collision marker while the bounded full-text reader retains it;
  the stack regression then consumes those corrected production semantics.
- Exact-ref end-to-end proof: the public PR's Murph Cloud integration lane owns
  the merged private Temporal checkout and the original two-scenario job. The
  available local private checkout is not that head, so it is not valid proof
  for this candidate.
