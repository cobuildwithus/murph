# Remove raw model code from persistent browser sessions

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent prompt-controlled hosted browser work from reading or transmitting
  cookies, storage state, hidden credentials, or other cross-origin authority
  from a member's persistent Kernel profile.
- Preserve useful authenticated browser tasks through the existing computer-use
  run, handoff, Managed Auth, and OS-control owners.

## Success criteria

- Persistent hosted browser runs no longer execute model-authored JavaScript or
  expose raw Playwright `page`, `context`, or `browser` objects.
- The assistant can still perform bounded navigation, visible-page inspection,
  locator interaction, ordinary non-sensitive form entry, waits, and
  verification through a server-owned structured contract.
- The structured action boundary has fixed result shapes and cannot reach
  cookies, storage state, request clients, routes, alternate contexts,
  arbitrary evaluation, or raw browser/session capabilities.
- Current handoff, Managed Auth, sensitive-input, run ownership, checkpoint,
  unknown-outcome, and finish behavior remains intact.
- Focused tests prove dangerous legacy requests fail schema validation and the
  supported structured operations preserve the primary browser journey.
- Required typechecks, canonical verification, preliminary specialist review,
  final exact-head ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - Hosted computer-use action contracts, assistant dynamic tool schema, Web
    execution adapter, focused tests, and current security/architecture/skill
    documentation.
  - Deletion of the raw persistent-profile Playwright surface.
- Out of scope:
  - A new browser service, queue, approval system, dependency, browser-profile
    owner, or generalized automation language.
  - Provider-specific browser adapters or unrelated computer-use lifecycle
    redesign.

## Constraints

- Reuse the existing signed computer-use callback, run row, Kernel client,
  persistent profile, handoff, and OS-control fallback.
- Prefer a finite discriminated operation contract over parsing, filtering, or
  denylisting JavaScript.
- Do not expose sensitive user input in structured action payloads; retain the
  current secure handoff boundary.
- Preserve product-critical authenticated browser tasks rather than disabling
  computer use or persistent profiles.
- Keep this ReviewGPT security batch in its own draft PR and do not merge it.

## Risks and mitigations

1. Risk: A broad replacement language recreates an interpreter and leaves
   equivalent capability escape hatches.
   Mitigation: Support only current demonstrated browser operations with
   server-owned branching and fixed return projections.
2. Risk: Removing raw code silently breaks ordinary authenticated workflows.
   Mitigation: Trace current skill examples, keep locator and OS-control
   fallbacks, and add primary-journey contract/service tests.
3. Risk: A string denylist misses aliases, computed properties, or alternate
   Playwright paths.
   Mitigation: Delete the raw-code field and never place privileged Playwright
   objects in model-controlled scope.
4. Risk: Browser lifecycle or Managed Auth is accidentally duplicated.
   Mitigation: Change only the action payload/executor below the existing run
   owner and leave profile, handoff, and provider controllers unchanged.

## Tasks

1. Ask the existing security discovery thread for one complete,
   deletion-first patch for the accepted finding.
2. Inspect and simplify the returned patch; reject any new lifecycle owner,
   JavaScript denylist, or speculative abstraction.
3. Implement the smallest complete structured action contract and focused
   security/product regression tests.
4. Update the current computer-use security, architecture, skill, and testing
   truth.
5. Run focused verification, typechecks, canonical acceptance, preliminary
   specialists, parent review, and final exact-head ReviewGPT/CI.
6. Commit, push, and open one separate draft, unmerged PR.

## Decisions

- Accepted the round-3 security finding after tracing the complete production
  path: visible untrusted page text reaches the model; the model authors an
  arbitrary `code` field; Web embeds it verbatim; Kernel executes it with the
  persistent profile's raw `page`, `context`, and `browser` objects.
- Rejected prompt hardening, substring filtering, and exact-action approval as
  complete fixes. None removes ambient credential-read authority from the
  execution boundary.
- Retain the existing computer-use owner and persistent profile. The missing
  boundary is the action contract, not the run lifecycle.
- Accepted the returned 15-file patch only after verifying its published hash,
  byte size, paths, reverse applicability, and full contents. It deletes the
  raw code field in favor of nine finite operations, bounded structured
  locators, server-generated Playwright, fixed result projection, and the
  existing sensitive-input preflight/handoff owner.
- Simplified the generated patch before verification: removed the unused
  `blocked` action-result branch and an unused preflight locator binding. The
  sensitive-input owner already fails before the action call, so retaining a
  second unreachable result protocol would add contract surface without
  behavior.
- Preserve current HTTP(S), including authenticated non-public navigation,
  while rejecting executable URL schemes. Removing raw code and arbitrary
  result projection closes the accepted persistent-credential authority bug;
  an unrelated browser-network redesign is outside this batch.
- Corrected generated test-only defects without broadening the runtime patch:
  wrapped skill prose is matched with whitespace-tolerant assertions, and two
  dynamic-code test fixtures use `fakePage` so their function-parameter type
  annotations do not self-reference the runtime variable.
- Updated the durable-doc index because this batch materially changes the
  indexed architecture and security boundaries.
- Kept the route-wide dynamic-tool description budget intact by deleting one
  redundant adjective from the new `computer_act` description; the focused
  description and computer-tool contract tests pass without increasing the
  existing 5,000-character cap.
- Parent review rejected the generated patch's raw CSS locator variant. A model
  could use attribute-prefix selectors plus the returned match count as an
  oracle over hidden DOM values. The finite contract now keeps only role,
  label, visible-text, placeholder, and test-id locators, and Web filters every
  server-compiled locator to visible matches before selection or projection.

## Verification

- Completed:
  - ReviewGPT security discovery round 3 completed with one high-severity
    finding and no patch.
  - Parent static validation confirmed the reachable raw-code-to-persistent-
    profile authority path and the absence of a runtime API sandbox.
  - ReviewGPT returned a model-verified patch with the expected
    `SECURITY_PATCH_COMPLETE` marker; its SHA-256 and 132,008-byte size matched,
    and `git apply --check` succeeded before any file edit.
  - Parent inspected all 3,005 patch lines, applied the 15 scoped existing-file
    changes through the repository editor, and removed the two dead concepts
    described above.
  - Hosted Execution focused tests passed (40 tests), Assistant Engine focused
    tests passed (281 tests), and Web focused tests passed (184 tests).
  - Hosted Execution, Assistant Engine, and Web typechecks passed.
  - Web lint passed with no errors; its 14 warnings are outside the changed
    files. Doc drift, doc gardening, diff whitespace, privacy-identifier,
    prohibited-source-cast, and generated/private-artifact checks passed.
  - The first canonical diff-aware run reached 177 passing Assistant Engine
    test files and found one six-character route-wide tool-description budget
    overflow. After the deletion above, both focused affected contract files
    pass (49 tests). Parent review then removed the hidden-selector oracle
    described above. The post-correction Hosted Execution contract file passes
    9 tests, the Assistant Engine computer-tool file passes 32 tests, and the
    Web computer-use file passes all 179 tests. The first Web run exposed one
    test-double missing the new visible-locator filter method; correcting that
    fixture made the unchanged runtime assertions pass. Hosted Execution,
    Assistant Engine, and Web typechecks then passed again.
  - The next canonical run found one stale skill-asset assertion whose pinned
    selector order no longer matched the reviewed prose. The exact asset file
    passes all 30 tests after aligning that assertion.
  - The following canonical rerun passed all 177 Assistant Engine files and
    2,749 tests plus Assistant CLI, Assistant Runtime, and Assistantd. Its CLI
    phase then timed out eight unchanged subprocess cases because their
    `build:test-runtime:prepared` children re-entered the outer workspace
    artifact lock and remained asleep after the test timeout. The parent stopped
    only that proven run tree. The branch still needs its scoped commit, merge
    to current `main`, and a fresh canonical run before this can be classified
    as a product failure.
- Remaining:
  - Canonical diff-aware verification and acceptance.
  - Preliminary specialist, final ReviewGPT, and CI gates.
