# Linear Browser Vault JSON serialization

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make large Browser Vault refreshes serialize in linear time so the existing
  30-second background deadline is spent on useful projection and publication
  work, without changing replica bytes, hashes, schema, or compatibility.

## Product UX

- Outcome: larger private dashboards regain fresh saved health data more
  reliably within the existing background refresh promise.
- Reaches: authenticated Web surfaces backed by Browser Vault refreshes,
  especially members with multi-megabyte replicas.
- Proof: on one neutral 5.85 MB fixture, the two serializer calls fell from
  12.69 seconds to 1.59 seconds while producing the same byte count; focused
  tests prove native JSON bytes, stable sorted bytes, failures, and
  cancellation remain unchanged.
- Walkthrough: ready. Large, sparse, escaped, and shared-reference values keep
  their existing output; unsupported roots, cycles, and foreground-priority
  cancellation keep their existing failures.

## Success criteria

- Cooperative serialization no longer rebuilds a growing partial chunk for
  every JSON token.
- Unsorted output remains byte-for-byte equal to the current supported
  `JSON.stringify` domain, and recursive sorted-key output remains unchanged for
  the Browser Vault `dataVersion` hash ABI.
- Abort, unsupported-root, array omission, shared-reference, and cycle behavior
  remain explicit and covered by focused tests.
- A production-shaped local benchmark records the before/after elapsed time
  without adding a timing-sensitive CI assertion.
- Focused package tests, typecheck, exact-head CI, and the repository review
  gates pass for the final PR head.

## Scope

- In scope:
  - The private cooperative JSON accumulator in `packages/query`.
  - Focused serializer behavior and regression coverage.
  - One member-visible changelog outcome shared with the related projection
    optimization when repository workflow permits that attribution.
- Out of scope:
  - Replica schema, projection generation, sharding, encryption, R2 transport,
    timeout policy, or retry behavior.
  - Removing the legacy monolith before its documented compatibility window.
  - Expanding the serializer to arbitrary ECMAScript `toJSON`, proxy, boxed
    primitive, or side-effectful getter semantics outside the replica domain.

## Constraints

- Technical constraints:
  - Preserve the iterative traversal, recursive key ordering, 16 KiB character
    chunk target, cancellation checks, and current public function signature.
  - Add no dependency, state owner, codec, or exported abstraction.
- Product/process constraints:
  - Browser Vault remains lower-priority, abortable runtime work and must not
    enter the foreground reply path.
  - Keep the generation-10 legacy producer until the dual-reader and rollback
    floor have remained in production for the documented minimum window.

## Risks and mitigations

1. Risk: A byte-level serializer change invalidates every replica data version.
   Mitigation: Preserve traversal/token ordering and assert exact bytes for
   representative nested, escaped, sparse, sorted, and oversized inputs.
2. Risk: Reducing yields or cancellation checks lets large refreshes outlive
   their owner.
   Mitigation: Leave the existing cooperative cadence intact and retain direct
   abort proof.
3. Risk: A wall-clock regression test becomes flaky across CI machines.
   Mitigation: Test semantics in CI and keep measured before/after timing in PR
   evidence only.

## Tasks

1. Capture the current focused serializer proof and a production-shaped local
   timing baseline.
2. Replace repeated partial-string concatenation with one bounded private
   fragment accumulator.
3. Extend focused tests for exact bytes and error/cancellation behavior.
4. Run focused proof, package typecheck, privacy/diff checks, and measured
   after-timing.
5. Open a draft PR, complete ReviewGPT and exact-head CI, close this plan, and
   mark the PR ready only after all completion gates pass.

## Decisions

- Preserve the existing serializer boundary instead of switching to native
  `JSON.stringify`, because recursive stable ordering and cooperative abort are
  current requirements.
- Use arrays of bounded fragments plus one join per completed chunk; do not add
  a class, streaming codec, or general-purpose serializer abstraction.

## Verification

- Commands to run:
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/browser-vault-replica.test.ts`
  - `pnpm --dir packages/query typecheck`
  - `pnpm test:scenario-integrity`
  - Exact-head required GitHub checks and repository ReviewGPT gates.
- Expected outcomes:
  - Focused behavior stays byte-compatible and all checks pass.
  - The neutral 5.85 MB fixture retains its exact 5,854,294-byte output while
    combined unsorted and sorted serialization falls from 12.69 seconds to
    1.59 seconds.
