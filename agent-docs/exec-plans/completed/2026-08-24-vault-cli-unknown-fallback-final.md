# Vault CLI value-free unknown fallback final remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Ensure every unowned Vault CLI failure returns a parseable, value-free
  `UNKNOWN` projection while preserving the existing typed domain, Zod, and
  fixed filesystem recovery owners.

## Success criteria

- Arbitrary `Error.message` text never reaches the projected `UNKNOWN` message.
- Typed `VaultCliError`, allowlisted `context.issues`, raw Zod, and fixed
  filesystem categories retain their current behavior.
- A provider-response path that echoes a synthetic submitted value is covered
  by a direct non-echo regression.
- Setup and main entrypoint bridges use the same fixed fallback.
- Canonical architecture guidance describes `context.issues` as the sole
  recovery metadata source and names no deleted repair channel.
- Focused tests, typechecks, package boundaries, privacy scans, runner bundle
  proof, exact-head CI, and final ReviewGPT round 4 pass.

## Scope

- In scope: shared error projection, its focused tests, one reachable Mapbox
  provider-response regression, and the stale CLI architecture bullet.
- Out of scope: provider-specific error taxonomies, new repair metadata,
  changes to native Incur errors, and unrelated CLI tool behavior.

## Constraints

- Technical constraints: one single recovery owner; fixed value-free fallback;
  no arbitrary message heuristics, new abstraction, or dependency.
- Product/process constraints: preserve exact-head review lineage, keep the PR
  Draft during remediation, use the original ReviewGPT thread, and pause on
  substantive findings.

## Risks and mitigations

1. Risk: Making all errors generic would regress model recovery.
   Mitigation: Change only the final unhandled branch and retain typed domain,
   structured validation, and fixed filesystem projections unchanged.
2. Risk: A sibling entrypoint preserves arbitrary error prose.
   Mitigation: Exercise both setup/main renderers and scan every projection
   call site.
3. Risk: Provider text re-enters through a concrete command wrapper.
   Mitigation: Reproduce a non-2xx provider response that echoes a synthetic
   submitted value and assert the final projection excludes both values.

## Tasks

1. Replace `safeUnhandledErrorMessage` with one fixed `UNKNOWN` message and
   remove the obsolete arbitrary-message test contract.
2. Add shared-projector and reachable provider-path non-echo regressions.
3. Correct the canonical CLI architecture bullet to the implemented owner.
4. Run focused runtime, typecheck, boundary, privacy, and bundle proof.
5. Close and commit the plan, push the exact head, restore Ready when eligible,
   and run ReviewGPT round 4 concurrently with CI.

## Decisions

- Accepted round-3 architecture drift and parent privacy findings are both
  remediated in this plan.
- Unexpected error prose is diagnostic-only and is not safe model-facing
  recovery metadata.

## Verification

- Commands to run: focused operator-config, CLI, setup, assistant, Cloudflare
  runner-contract tests; affected typechecks; package-shape and workspace
  boundary/cycle checks; production runner bundle/parity; privacy and diff
  scans; exact-head CI; original-thread ReviewGPT round 4.
- Expected outcomes: all checks pass, generated package artifacts remain
  aligned, no arbitrary submitted/provider prose reaches `UNKNOWN`, and the
  final review returns `ROUND_OUTCOME: PASS`.

## Progress

- Re-proved exclusive ownership at exact head
  `adba242ac095edc6778b76d2b7b0590fbd00824d`, returned PR #2202 to Draft,
  and inspected the existing Frog inventory before edits.
- Deleted arbitrary unhandled-message preservation. Typed `VaultCliError`,
  allowlisted `context.issues`, raw Zod, and fixed filesystem projections are
  unchanged; every remaining unowned error now uses one fixed `UNKNOWN`
  message.
- Added direct non-echo proof for the shared projector, main pre-serve renderer,
  setup bridge, and a real Mapbox rejection whose raw error contains both a
  synthetic submitted value and provider body.
- Corrected the single stale canonical architecture bullet; immutable completed
  plans remain historical snapshots.
- Focused suites passed: operator-config 24, setup 34, assistant 89, CLI 110,
  inbox 10, and Cloudflare runner-contract 14 tests. The prepared built-runtime
  Incur suite passed 68 tests.
- All six affected typechecks, CLI package shape, workspace boundaries/cycles,
  docs drift, diff/privacy/unsafe-cast scans, and provider-input no-change proof
  passed.
- The production runner bundle and parity probes passed at 9,464,730 of
  9,467,648 bytes, 578 bytes smaller than the prior reviewed head. Entry and
  static-startup budgets remain unchanged.
- The implementation plan closes with the scoped remediation commit. Exact-head
  CI and original-thread ReviewGPT round 4 remain the PR admission gates after
  the push.
Completed: 2026-08-24
