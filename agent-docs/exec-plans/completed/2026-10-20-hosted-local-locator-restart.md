# Preserve idempotent snapshot fixture setup across local worker restarts

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

- Keep hosted release verification from failing during idempotent snapshot fixture setup when Wrangler explicitly reports a mid-request worker restart.

## Success criteria

- Reproduce the exact restart response synthetically before correction, then prove successful bounded completion afterward.
- Preserve ordinary HTTP/network failures, authentication, fixture bytes, and every scenario assertion. Never retry arbitrary mutating test requests.
- Pass focused tests, Cloudflare typecheck, final ReviewGPT and required exact-head CI.

## Scope

- In scope: existing hosted-local test helpers and focused regressions for the exact restart condition at the idempotent marker boundary.
- Out of scope: production retries, timeouts, schema/state, provider messages, gate removal, and unrelated harness refactors.

## Constraints

- The marker validates the bound identity and snapshot key, then puts the same zero-byte object. Repeating that exact request is idempotent even if the first write completed.
- The existing wake helper already recognizes the same Wrangler restart response and bounds recovery. Reuse its policy where practical without broadening retry admission.
- ReviewGPT authors the substantive change. Use synthetic evidence only. Preserve other owners' changes.

## Risks and mitigations

1. Retrying an unrelated or ambiguous failure could hide a defect or repeat effects. Require the exact response class and narrow operation scope; prove non-retry cases and exhaustion.
2. Fixture retries could recreate or alter encrypted artifacts. Prove stable marker body and identity across attempts; snapshot upload and canonical fixture creation remain single operations.

## Tasks

1. Ask ReviewGPT for the smallest implementation and focused tests.
2. Apply tests first, capture the expected failure, then apply and critically inspect the correction.
3. Verify, record public-safe friction, commit, push, review and merge through the existing gates.
4. Verify the canonical hosted admission actually reaches its scenario outcome; preserve unrelated rollout findings.

## Decisions

- An observed hosted admission failed before the foreground scenario with Wrangler's explicit mid-request-restart 503. The marker route itself has no 503 branch. No production regression is inferred from that local test failure.
- Open PRs were checked. The only overlapping harness change adds unrelated auth fields; it does not collide with request handling.

## Verification

- Focused Vitest proofs for affected helpers and `pnpm --dir apps/cloudflare typecheck`.
- Demonstrate exact restart then success, bounded exhaustion, wrong status/body and arbitrary POST failure propagation, and unchanged fixture identity/body.
- Full hosted-local reproduction requires Docker; use hosted exact-head CI for that environment and do not claim an unavailable local full-stack run.

## Implementation and evidence

- ReviewGPT authored the implementation and synthetic regressions. The parent inspected the complete patch and applied tests before implementation.
- Tests-only reproduction: four expected failures and 48 passes. The composed encrypted snapshot fixture fails at the exact restart response before restoration, and the harness stops after one attempt.
- Corrected result: all 52 focused helper tests pass. They prove the actual success response, five-attempt exhaustion with waits of 250, 500, 750 and 1,000 milliseconds, stable authenticated request identity, exclusion of unrelated failures and requests, and one setup/encryption/upload before restoring the original bytes.
- A small test-only transport helper shares the existing wake restart policy. The harness admits it only for the exact marker POST on the configured Worker origin with a reusable string body. Production code and deployment settings are unchanged.
- Cloudflare typecheck passes. The complexity guard passes with no production JavaScript or TypeScript source changes to analyze; all implementation paths are test helpers. The retry helper has one finite loop and preserves the final response for existing diagnostics.
- Local full-stack execution is unavailable because Docker is not running. Final review, required CI and canonical hosted admission remain external completion gates, tracked on the PR rather than claimed by local proof.
Completed: 2026-10-20
