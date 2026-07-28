# Cloudflare Preview Staging Final-Review Remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Resolve the accepted final ReviewGPT findings without changing the single
  deploy-owner architecture or weakening preview isolation.

## Success criteria

- Preview preflight rejects Worker/Web self-routing and production device-sync
  callback aliases before mutation.
- Preview device-sync callback HTTPS, staging identity, and public DNS are
  covered directly.
- The documented direct-production OIDC default remains compatible, while
  preview/development still require explicit context.
- Focused tests, canonical diff verification, acceptance, final ReviewGPT
  correction verification, and final-head CI pass.

## Scope

- In scope:
  - `apps/cloudflare/scripts/deploy-preflight.ts`
  - focused deploy preflight and automation tests
  - exact current deploy docs only if behavior clarification is required
- Out of scope:
  - new services, state, deployment owners, or provider mutation
  - staging resource bootstrap before the isolated preview Web boundary exists

## Constraints

- Technical constraints:
  - reuse existing URL and DNS validation helpers
  - production raw env may omit the OIDC variable and use the renderer default
- Product/process constraints:
  - keep the PR draft and undeployed until final gates pass
  - never read or copy production secret values

## Risks and mitigations

1. Risk: callback validation rejects valid path-bearing staging endpoints.
   Mitigation: validate the origin for topology/identity while preserving the
   full path-capable callback URL.
2. Risk: compatibility fix weakens preview context enforcement.
   Mitigation: require OIDC explicitly for preview/development and retain
   cross-context mismatch validation for every explicit value.

## Tasks

1. Add the narrow topology and callback invariants in the existing preflight.
2. Restore the production raw-environment default contract.
3. Add direct regression and deployment-order coverage.
4. Run required verification, close the remediation plan, push, and complete
   final ReviewGPT/CI.

## Decisions

- Accept both final round-1 findings as original-PR defects.
- Keep all corrections inside the existing preflight/test owners.

## Verification

- Focused deploy preflight/deploy automation/deploy-order tests: passed,
  101 tests.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- Canonical `pnpm test:diff ...`: passed, including 2,009 Cloudflare Node
  tests and 2 Workers-runtime tests.
- `pnpm verify:acceptance`: all staging, Cloudflare, Web, typecheck, build,
  hygiene, and other owner-package lanes passed. The parallel package-coverage
  phase reported two unrelated load-sensitive failures:
  - Assistant Runtime clinical-records preemption expected the domain error but
    observed the underlying abort error.
  - Setup CLI interactive Venice selection completed with the initial option.
  Both exact test files passed immediately in isolation (35/35 and 6/6).
  A supported one-worker full rerun was queued, but the shared-host scheduler
  repeatedly admitted unrelated Web, Cloudflare, and acceptance owners first;
  only this session's waiting process was stopped. The scoped diff lane and
  initial exact full-run evidence prove the current diff did not touch either
  failing owner.
- Invalid preview topology is directly proven to fail before artifact
  validation, lifecycle changes, or deploy.
- Production direct deploy retains the source-controlled OIDC default;
  preview/development require an explicit matching value.
- Final ReviewGPT round 2 and final-head CI remain post-push gates.
Completed: 2026-07-27
