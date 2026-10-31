# Recover trusted inactive Worker uploads during full runner rollout

Status: completed
Created: 2026-10-31
Updated: 2026-10-31

## Goal

Permit an explicitly selected, trusted failed upload to be superseded by a fresh
full runner rollout without activating or deleting the leftover.

## Scope and constraints

Extend the existing public recovery path and private workflow admission. Preserve
exact UUID/tag, secret inventory, raw version adjacency, live identity, rendered
secrets, native rollout, smoke, and final promotion checks. No automatic candidate
discovery, and the leftover upload is never activated or deleted.

## Findings and decisions

- The ordinary upload requires the latest version to equal the live baseline;
  a successful upload followed by a provider read failure leaves that false.
- Remove the worker-only recovery restriction. Restrict recovery/live adjacency
  to the initial upload; promotion retains the fresh promotion/stage check.
- Require the recovery upload creation time to follow the latest deployment,
  excluding prior activation followed by rollback without another API reader.
- Explicit owner selection and exact tag remain the provenance boundary. Matching
  secret inventory cannot attest opaque values. Synchronized secrets remain
  mandatory and optional inherited secrets retain the existing trust requirement.
- Cloudflare's public DELETE reference does not define error 10339 or a latest
  version deletion prohibition. Leave the destructive helper unchanged; document
  deletion as an unverified route and use recovery inputs for deploys.

## Verification

- Public dependencies installed, but the final hook setup failed because the
  supplied checkout lacks storage-guard creation authorization. No guard bypass.
- `pnpm build:test-runtime`: exit 0.
- Focused deploy CLI, recovery inventory, and shared deployment tests: 166 pass.
  Regression reproduces a provider read failure after upload, ordinary retry
  refusal, and explicit recovery through gradual/immediate rollout and promotion.
- `pnpm typecheck`: exit 0.
- `pnpm complexity:diff`: exit 0; no new complexity debt.
- Private workflow shell admission tests: 19 pass, including all rollout modes,
  missing selection, disabled secret sync, skipped-gate policy, and env wiring.
- Private `pnpm test:cloudflare-capacity`: exit 0, 262 tests pass.
- Private `pnpm verify`: exit 1 in unrelated ReviewGPT fixture tests because the
  local privacy hook rejects their synthetic non-noreply Git email. No hook
  bypass or unrelated test change was attempted.
- Private `pnpm typecheck`: exit 0.
- Both worktrees: `git diff --check` passes.

## Handoff

Implementation and local review are complete; changes remain uncommitted by
request. Public typecheck and focused proof pass. Private full verification is
blocked as described above; targeted workflow proof and typecheck pass. Provider
error 10339 remains unmapped in the public reference; no live provider operations
were attempted. Exact production dispatch inputs belong in the private operator
handoff, not this public implementation record. No public changelog is needed for
this deployment-tooling correction.
Completed: 2026-10-31
