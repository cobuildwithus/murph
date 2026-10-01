# Frog #2429 ReviewGPT First-Turn Identity

Status: completed
Created: 2026-08-29
Updated: 2026-08-30

## Goal

- Let detached ReviewGPT wake recover an accepted first user turn after its
  provisional signature-based DOM identity becomes a canonical message ID,
  without weakening exact-thread or exact-turn validation.

## Success criteria

- A deterministic regression reproduces the current zero-match rejection for a
  zero-baseline first turn whose exact index and prompt signature are unchanged
  while its DOM turn ID stabilizes.
- The installed ReviewGPT owner accepts only the cryptographically consistent
  provisional-to-canonical identity transition and upgrades completed capture
  metadata to the canonical turn ID.
- Mismatched signatures, indexes, extra user turns, and ambiguous candidates
  still fail closed.
- Dependency policy, focused repository-tooling tests, typecheck, diff hygiene,
  and public-safety inspection pass.

## Scope

- In scope: the pinned `@cobuild/review-gpt` capture-identity matcher and a
  Murph-owned regression proving the exact dependency behavior.
- Out of scope: live managed-browser reproduction, browser-profile mutation,
  wake process launching, unrelated ReviewGPT recovery behavior, and any other
  Frog issue.

## Constraints

- Technical constraints: preserve exact thread, turn index, hashed prompt
  signature, latest-request, assistant-response, and artifact gates; patch both
  shipped source and runtime output through pnpm's reviewed dependency-patch
  mechanism.
- Product/process constraints: no production product behavior changes; keep the
  PR draft through deterministic proof and exact-head review; dependency and
  lockfile scope requires a reviewed human handoff rather than autonomous merge.

## Risks and mitigations

1. Risk: accepting a canonical ID could bind wake to a different user turn.
   Mitigation: allow the transition only when reconstructing the provisional ID
   from the live role, exact turn index, and live signature yields the stored
   hashed fallback identity; retain the unique-match and latest-turn checks.
2. Risk: patching source without shipped runtime leaves behavior unchanged.
   Mitigation: patch both `src` and `dist`, and execute the regression against
   the installed runtime entrypoint.

## Tasks

1. Add and run the focused failing capture-identity regression.
2. Create the smallest pnpm dependency patch in the capture owner.
3. Rerun focused proof plus dependency/type/diff/public-safety checks.
4. Commit, push, open the draft PR, and run the required exact-head review and
   CI gates without touching another lane's browser resources.

## Decisions

- The report remains current on ReviewGPT `0.5.139`, the latest registry release
  and Murph's pinned version; there is no newer upstream release to consume.
- The stable authority is the exact turn index plus hashed prompt signature.
  The provisional turn ID is derived from those values, so a canonical DOM ID
  may replace it only when that derivation proves the same turn.
- Patching the pinned package is preferred to a Murph wrapper: the capture
  matcher is the existing owner, and the latest published and upstream source
  still has the defect. The patch stays visible in pnpm's reviewed dependency
  controls and can be removed when upstream publishes the correction.

## Verification

- Pre-fix focused proof failed with `Captured committed user-turn identity
  resolved to 0 turns` for the exact first-turn stabilization case.
- The repaired focused suite passes six cases: successful canonical rebinding,
  signature mismatch rejection, wrong user-index rejection, wrong assistant
  preceding-index rejection, later-request rejection, and ambiguous-candidate
  rejection.
- The owning CLI release-script audit passes 48 tests with one intentional skip.
- `pnpm test:repo-tools` passes 50 files and 681 tests.
- CLI typecheck, patched-runtime syntax, frozen install, dependency policy,
  ignored-build inventory, and `git diff --check` pass.
- `pnpm deps:audit` reports the repository's existing dependency advisories.
  The task changes no package version or transitive dependency edge; its lockfile
  diff adds only the patch hash/path to the already-installed ReviewGPT snapshot.
Completed: 2026-08-30
