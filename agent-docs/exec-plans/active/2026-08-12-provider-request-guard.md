# Expand the external provider request guard

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Make the external provider guard detect production SDK bypasses instead of
  only validating request objects at a small registered set of SDK call sites.
- Preserve the narrow raw-transport exceptions required for presigned byte
  transfers, internal traffic, generic runner proxying, dynamic SMART/FHIR
  endpoints, providers without a verified provider-owned TypeScript SDK, and
  xAI's OpenAI-compatible extensions.

## Success criteria

- The guard scans relevant operational JavaScript modules as well as
  TypeScript sources.
- Raw provider fetches, handwritten provider request/response contracts, and
  configurable provider origins are mechanically rejected unless a narrow,
  documented exception applies.
- Focused regression fixtures cover the reported Junction, Linq, OpenAI, and
  operational-script blind spots plus every accepted exception class.
- The guard and its documentation no longer overstate their coverage.
- Focused verification, exact-head CI, preliminary ReviewGPT specialists, and
  the final ReviewGPT loop complete with no unresolved accepted finding.

## Scope

- In scope:
  - `scripts/check-provider-request-boundaries.ts` and its focused tests.
  - The guard's registered provider and exception policy.
  - Durable security/testing documentation that describes the guard.
- Out of scope:
  - Migrating individual provider call sites to SDKs; sibling work owns those
    corrections.
  - Changing provider behavior, credentials, retries, timeouts, or product
    flows.

## Constraints

- ReviewGPT authors the first implementation patch; the parent inspects,
  applies, integrates, and verifies it.
- Prefer one explicit guard policy over a second inventory or detector.
- Exceptions must be path- and purpose-scoped rather than provider-wide.
- Keep direct identifiers, credentials, private provider payloads, and local
  filesystem paths out of durable artifacts.

## Risks and mitigations

1. Risk: broad URL matching flags internal traffic or provider byte transfers.
   Mitigation: prove each allowed transport class with explicit fixtures and
   require narrow exception metadata.
2. Risk: the guard is coupled to current migrated call-site syntax.
   Mitigation: use semantic AST evidence and mutation-style fixtures for the
   bypass classes rather than exact source-text snapshots.
3. Risk: the guard lands before sibling SDK migrations and makes CI red.
   Mitigation: keep the PR active, rebase only when the sibling migrations are
   available, and require a clean current-base guard run before merge.

## Tasks

1. [x] Inventory the current guard, tests, provider call sites, and exception
   classes.
2. [x] Ask ReviewGPT for a bounded implementation patch and inspect every hunk.
3. [x] Apply the accepted implementation, strengthen focused tests, and update
   truthful documentation.
4. [x] Run focused verification and direct positive/negative guard scenarios.
5. [ ] Push the exact candidate, run preliminary and final ReviewGPT audits
   with CI, remediate accepted findings, and close this plan.

## Decisions

- This is internal-only verification tooling; changelog is not applicable.
- The final guard is expected to fail against unmigrated production bypasses;
  merge readiness requires the sibling SDK migrations to remove those failures
  or a narrowly justified registered exception.
- Accepted the preliminary coverage specialist's three findings: presigned
  transfers now require static credential/header safety plus byte/stream proof,
  fetch aliases resolve at the nearest lexical binding, and SMART/FHIR does not
  exempt explicit registered-provider identifiers or hosts.
- Direct-entry detection compares normalized filesystem paths so the `tsx`
  package script cannot silently skip the guard when its module URL carries
  loader metadata.
- Accepted the first full-patch audit's transport and evidence findings:
  canonical Retell/Composio hosts and imported Node/Undici calls are registered,
  provider evidence accumulates instead of returning on the first label, and
  protocol-relative or backslash network paths are never treated as internal.
- Rejected a temporary baseline or warning mode for the intentionally red draft.
  The branch stays non-mergeable until the sibling provider migrations remove
  every current finding, matching the user-requested sequencing gate.

### ReviewGPT round 2 requirement-level retrospective

- Original requirement: one fail-closed guard must identify low-level requests
  and handwritten wire contracts for SDK-backed providers, while raw transport
  remains possible only through exact, structurally proven exceptions.
- First reviewed head `a55eb238e9cc69def11720b26a901e7489b07488`
  changed 3,097 lines. The round-2 head changed 3,713 lines, an increase of 616
  lines driven mainly by transport/evidence fixes and their regression matrix.
- The growth exposed a repeated mechanism: provider evidence, SMART/FHIR
  admission, presigned-transfer admission, and transport discovery each gained
  syntax-specific walkers or name heuristics. Those parallel owners can
  disagree, so a stronger fact discovered by the main classifier can be lost
  by an exception.
- Redesign decision: continue this PR because the guard, its executable matrix,
  and its policy documentation are one verification owner, but shrink and
  centralize the implementation before further tactical fixes. Provider
  migrations remain separate.
- One expression-fact collector will own resolved provider identities and
  explicit provider signals. Candidate classification and every exception will
  consume that same result. Delete the separate explicit-provider walker.
- Internal traffic will be limited to a statically known single-slash relative
  path or an exact trusted same-origin base. Dynamic template composition is not
  internal proof.
- Transport bindings will cover scoped ESM and CommonJS forms, including direct
  imports/requires, destructuring, namespace destructuring, and shadowing, for
  every scanned extension the guard advertises.
- Presigned transfers will accept only literal safe headers or the result of an
  explicit audited transfer-header factory, together with an opaque URL and an
  exact byte/stream method and payload shape. Variable-name and source-text
  heuristics will be deleted; stream piping will be established through AST
  bindings.
- xAI will no longer have a provider-wide exception. The only admitted raw xAI
  operation will be the existing path-scoped Responses request whose method and
  request body structurally prove the single `x_search` extension shape.
- Retell and Composio host ownership will be asserted directly, and composed
  fixtures will cross transport syntax, provider evidence, and exception shape
  so isolated helper tests cannot conceal disagreements.
- Accepted all round-2 implementation findings above. The intentionally red
  repository scan remains an accepted sequencing gate rather than a guard
  defect. If remediation needs another policy owner or materially exceeds this
  central-facts/exact-exception design, pause for a new requirement-level
  retrospective instead of layering another heuristic.

## Verification

- `pnpm provider-requests:guard`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage scripts/check-provider-request-boundaries.test.ts`
- `pnpm test:repo-tools`
- `pnpm test:diff scripts/check-provider-request-boundaries.ts scripts/check-provider-request-boundaries.test.ts agent-docs/SECURITY.md agent-docs/references/testing-ci-map.md`
- `git diff --check`
- Exact-head CI and routed ReviewGPT passes.

Current evidence:

- Focused guard suite: 51 tests passed.
- Repository-tool suite: 34 files and 557 tests passed.
- Tools TypeScript no-emit check and `git diff --check`: passed.
- `pnpm provider-requests:guard`: intentionally exits 1 with 43 current
  low-level provider transports/contracts; sibling migrations own those call
  sites.
- Diff verification reaches the provider guard and stops on the same expected
  findings.
