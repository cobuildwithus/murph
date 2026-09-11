# Isolate hosted-local Cloudflare source snapshot preparation

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Give hosted-local Cloudflare source copying and workspace materialization one
  focused owner, with the existing stack remaining the lifecycle owner.

## Success criteria

- Preserve copied content, dependency traversal order, skip/error behavior,
  per-dependency external symlinks, abort checks, and public stack entrypoints.
- Prove the builder against a small synthetic filesystem and retain existing
  stack, main, harness, and public package-resolution coverage.

## Scope

- In scope: snapshot builder extraction, shared path constant, focused tests.
- Out of scope: startup lifecycle, credentials, runner preparation, dependency
  policy, deployed runtime behavior, and the concurrent authentication PR.

## Constraints

- Reuse existing path constants and runtime abort checking; no reverse imports,
  dependency changes, lifecycle wrappers, or runtime parameters solely for tests.
- Base: b80bd40f84d1b367c1810e2fe046e3089cc28aa4. Separate task checkout.
- Root owns final candidate review, Ready, ReviewGPT and exact-head CI.

## Risks and mitigations

1. Snapshot copying could accidentally alias mutable workspace artifacts.
   Mitigation: preserve function bodies and verify real copies plus exact links.
2. Dependency traversal or failure ordering could change during extraction.
   Mitigation: retain traversal unchanged and test cycles, missing packages/dist,
   ignored dependencies, cancellation, and invalid package manifests.
3. Concurrent PR #3134 changes stack authentication integration.
   Mitigation: its snapshot cluster and snapshot assertions are identical to the
   base; preserve surrounding authentication and lifecycle code unchanged.

## Tasks

1. Move the complete snapshot closure into cloudflare-source-snapshot.ts and the
   shared runner-bundle path into constants.ts; update the sole caller import.
2. Add filesystem proof through mocked existing path ownership, retaining stack
   integration tests and public exports.
3. Run focused tests, prerequisite package builds, typecheck, complexity diff,
   source-identity comparison, and privacy/diff review.
4. Prepare complete PR evidence; close this plan with a scoped neutral-identity
   commit, push, and open a draft for root completion ownership.

## Decisions

- Release-package helpers are not reused: their publication filtering, missing
  dependency handling, and ordering differ from hosted-local materialization.
- Source snapshot output stays temporary and stack-owned; no new persisted state,
  product policy, deploy compatibility requirement, or member-facing changelog.

## Verification

- Frozen dependency installation in this checkout; no sibling build reuse.
- Focused Vitest: snapshot, stack, main, harness, and package boundary tests with
  at most two workers; package typecheck; pnpm complexity:diff against the base.
- Exact moved source identity and unchanged stack lifecycle/call ordering.
- Passed: pnpm install --frozen-lockfile --reporter append-only.
- Passed: pnpm --filter '@murphai/hosted-local-harness^...'
  --workspace-concurrency=1 run build (12 prerequisite packages).
- Passed: MURPH_HOSTED_LOCAL_HARNESS_TEST_PACKAGE_BOUNDARY=1 pnpm --dir
  packages/hosted-local-harness exec vitest run --config vitest.config.ts
  --no-coverage --maxWorkers=2 --silent=true
  test/dev-hosted-local/cloudflare-source-snapshot.test.ts
  test/dev-hosted-local/stack.test.ts test/dev-hosted-local/main.test.ts
  test/harness.test.ts test/package-boundary.test.ts (94 tests, five files).
- Passed: pnpm --dir packages/hosted-local-harness typecheck.
- Passed: pnpm complexity:diff --base b80bd40f84d1b367c1810e2fe046e3089cc28aa4.
  The extracted module has maximum complexity 6 and no debt. Stack startup stays
  at 139 with unchanged debt; its ordered lifecycle remains one owner.
- Passed: byte comparison of the complete moved function cluster (apart from
  its export keyword), private helper bodies, and stack startup/lifecycle body.
- Frog list checked after frozen installation; no task-specific friction entry.
- Broad runtime/acceptance proof, final review and exact-head CI belong to the
  root completion owner. No live stack or deployed runtime was exercised locally.
Completed: 2026-09-10
