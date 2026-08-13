# Expand the external provider request guard

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

- Make the external provider guard detect production SDK bypasses instead of
  only validating request objects at a small registered set of SDK call sites.
- Preserve narrow raw transport for presigned byte transfers, internal traffic,
  generic runner proxying, dynamic SMART/FHIR endpoints, providers without a
  verified provider-owned TypeScript SDK, and the existing path-scoped xAI
  `x_search` Responses extension. Generic runner and SMART/FHIR expressions
  need no exception when they carry no registered-provider facts.

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
- Implemented the redesign with one provider-expression fact collector shared
  by candidate classification and every exception, scoped ESM/CommonJS
  transport bindings, static-only internal paths, registered transfer-header
  factories, AST-bound stream piping, and one exact xAI request exception.
- The correction head changes 4,332 lines, 619 more than the reviewed round-2
  head. That increase is the retrospective's declared scoped-binding, exact-xAI,
  and composed-fixture redesign; the parallel provider walker, dynamic-header
  name heuristic, and source-text stream proof were deleted rather than
  extended.
- ReviewGPT round 3 accepted three bounded bypasses inside that same design:
  effective-value overrides in the xAI object literals, direct CommonJS
  transport invocations that skipped binding discovery, and text-only trust in
  `request.url`/`input.request.url` as same-origin bases. The correction rejects
  open or custom-serialized xAI objects, reuses the existing transport module
  and method classifiers for direct `require(...)` calls, and deletes the two
  unproven origin spellings. Parent review also bound each registered transfer
  header factory call to its unique audited top-level declaration instead of
  trusting a same-named local function. No new policy owner or compatibility
  path was introduced.
- ReviewGPT round 4 accepted two remaining coverage gaps within the existing
  design. The lexical census now includes TypeScript import-equals declarations
  and every name bound by destructured function parameters, so provider SDKs,
  transports, and shadows cannot disappear through those forms. The shared
  expression facts now follow computed origin maps and merge provider evidence
  from explicitly transport-shaped call targets such as an injected
  `openAiFetch`, while root-relative traffic cannot erase that explicit target
  evidence. Parent review kept static response-member reads and project-owned
  provider handlers outside that target rule, preserving presigned byte
  transfers and internal handler composition without adding an exception.
- The first round-5 attempt was diagnostic because its required model
  self-attestation was `UNKNOWN`; it did not advance the substantive-round
  counter. Its three reachable findings were accepted within the existing
  retrospective design. Assigned CommonJS namespaces now compare the nearest
  declaration identity and fail after reassignment; destructured property types,
  exact fetch-compatible provider targets, and array-backed origins stay in the
  shared binding/fact pipeline. Presigned admission rejects spread call init and
  uses only AST/global-binding or exact type proof for byte bodies. Incoming
  runner pass-through requires exactly one non-spread `Request` argument. Loose
  `Request` handlers remain outside provider-target evidence, so no exception or
  second resolver was added.
- The valid round-5 retry accepted two remaining fact-flow gaps and one
  complexity collapse. The shared fact collector now retains nested
  destructured property provenance, follows exact properties only through
  closed local object/array literals, and inspects provider-bearing fetch tuple
  spreads before exception matching. Opaque spreads cannot enter any structural
  exception. Incoming-Request and SMART/FHIR exception owners were deleted:
  production-path fixtures prove the actual generic runner and clinical SMART
  calls carry no registered-provider facts, while provider-bearing lookalikes
  fail normally. Parent production-path review also removed the real Linq
  presigned byte `PUT` from the migration inventory by binding its provider-named
  URL to the unique audited owner-path normalizer, alongside the already bound
  header factory. Parent review then deleted the remaining transfer URL/source
  naming heuristics: every retained production byte or stream operation now
  resolves to a unique registered owner, and the streamed direct-R2 smoke must
  additionally prove the exact request binding and pipe target. This is not a
  provider-wide allowance.

## Verification

- `pnpm provider-requests:guard`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-provider-request-boundaries.test.ts`
- `pnpm test:repo-tools`
- `pnpm test:diff scripts/check-provider-request-boundaries.ts scripts/check-provider-request-boundaries.test.ts agent-docs/SECURITY.md agent-docs/references/testing-ci-map.md`
- `git diff --check`
- Exact-head CI and routed ReviewGPT passes.

Current evidence:

- Focused guard suite: 77 tests passed after the round-5 correction.
- Repository-tool suite: 34 files and 583 tests passed after the round-5
  correction and current-base merge. The earlier round-4 contended run timed out two
  Crabbox repeated-signal cases; that file passed alone and each quiet full
  rerun passed.
- Tools TypeScript no-emit check and `git diff --check`: passed.
- `pnpm provider-requests:guard`: intentionally exits 1 with 43 current
  low-level provider transports/contracts; sibling migrations own those call
  sites. The removed 44th item was the actual Linq presigned byte transfer,
  which policy explicitly retains as raw transport.
- Diff verification reaches the provider guard and stops on the same expected
  findings.
