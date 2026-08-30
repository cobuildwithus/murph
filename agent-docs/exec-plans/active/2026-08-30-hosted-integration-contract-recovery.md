# Restore hosted integration contracts

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Restore the hosted integration gate by aligning with the current Codex and
  group-tool contracts, including the narrow Venice provider-boundary adapter
  for the current Responses Lite item identity.

## Success criteria

- The Venice Responses Lite scenario accepts the current stable
  `additional_tools` item identity, removes it at the provider boundary, and
  still rejects malformed identities and tool envelopes.
- The usage-limit private-to-group handoff scenario follows the production
  membership-inventory and exact-membership consultation path and delivers once.
- The private integration job initializes its PostgreSQL service database
  explicitly before the focused concurrency suite.
- The exact public and private PR heads pass focused local proof, required
  ReviewGPT gates, and required CI.

## Scope

- In scope:
  - The current Codex Responses Lite item identity at the Venice adapter and
    its hosted-local proof.
  - The stale private-to-group handoff fixture.
  - The private integration workflow's empty PostgreSQL service setup.
  - Cross-repository exact-head verification of those corrections.
- Out of scope:
  - Runtime, mailbox, Temporal, or database behavior outside the Venice
    Responses Lite compatibility adapter.
  - The unrelated device-sync/runtime changes preserved in the older dirty
    recovery worktree.
  - New queues, schedulers, fallback owners, or compatibility machinery.

## Constraints

- Technical constraints:
  - Reuse current tool and database setup owners; add no dependency or new
    abstraction.
  - Preserve every existing provider-envelope, authority, settlement, and
    exact-delivery assertion not disproven by the current contract.
  - Keep the other dirty worktree untouched.
- Product/process constraints:
  - Internal proof recovery only; no member-visible behavior change or
    changelog entry.
  - Use separate public and private PRs because each repository owns its own
    correction.

## Risks and mitigations

1. Risk: Updating a fixture could hide a production regression.
   Mitigation: assert the exact current upstream identity shape, derive the
   handoff target only from protocol-owned inventory output, and preserve the
   existing delivery and settlement assertions.
2. Risk: Database setup could restore the old destructive inherited-database
   coupling.
   Mitigation: initialize only the job-owned PostgreSQL service through the
   repository's canonical schema command; hosted-local scenarios remain
   isolated.
3. Risk: Cross-repository movement could invalidate proof.
   Mitigation: record and verify the immutable public SHA used by the private
   integration run.

## Tasks

1. Reproduce and classify all failures on the latest private main run.
2. Correct the two public test contracts with focused deterministic coverage.
3. Correct the private PostgreSQL setup at the workflow owner.
4. Run focused public tests/typecheck and private verification.
5. Push exact candidates, run required specialist/final reviews concurrently
   with CI, resolve accepted findings, and close the plan.

## Decisions

- The Temporal compatibility failure is already resolved by the merged public
  controller advance and is not part of this diff.
- The group-handoff and PostgreSQL failures do not justify production runtime
  changes. The Codex failure does require the narrow provider-boundary adapter
  to accept and discard the new upstream `at_` item identity.

## Verification

- Commands to run:
  - Focused Vitest coverage for both public hosted-local fixtures or their
    narrowest stable contract owners.
  - Cloudflare package typecheck and `git diff --check`.
  - Focused Venice adapter unit coverage for accepted and malformed identities.
  - Private `pnpm verify` plus the narrowest workflow contract tests.
  - Exact-head Public Murph Integration CI using the public candidate SHA.
- Expected outcomes:
  - Both scenarios pass with their existing terminal/delivery assertions.
  - The PostgreSQL concurrency step starts from a fully initialized schema.
  - The only production source change is the narrow Venice identity validator.
