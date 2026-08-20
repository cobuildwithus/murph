# Restore production runner bundle budget margin

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Restore the production Cloudflare runner release by reducing the real Linux
  `vault-cli` esbuild graph below its existing byte budget with durable margin,
  without weakening the cap or changing the Junction profile-replay behavior
  that caused the latest graph growth.

## Success criteria

- Prove the exact source of the 1,133-byte production budget violation at public
  main `9ebf4a477ebd6f903987396fb79a37eaca67e93c`.
- Lower the total cap from 9,397,704 bytes after removing avoidable output
  expansion, while keeping both startup-closure budgets unchanged.
- Reduce the canonical production Linux bundle by materially more than 1,133
  bytes while preserving the Junction timestamp-migration tests and CLI bundle
  parity/boundary tests.
- Land focused tests, typechecks, exact-head CI, required ReviewGPT gates, and a
  merge-ready PR; deployment remains with the parent incident owner.

## Scope

- In scope: the smallest behavior-preserving esbuild output correction,
  regression proof, bundle measurement, and deploy notes.
- Out of scope: raising the bundle budget, removing member-visible CLI commands,
  changing provider semantics, merging, or deploying.

## Constraints

- Technical constraints: production builds run on Linux and local macOS bundle
  bytes may differ; use the canonical Linux lane for the release decision.
- Product/process constraints: preserve the exact accepted timestamp-only
  profile replay migration, reject semantic/ambiguous drift atomically, keep
  provider input behavior unchanged, and retain the existing budget guard.

## Risks and mitigations

1. Risk: source-level deletion for size could weaken Core's exact replay
   identity or duplicate/tombstone protections.
   Mitigation: leave the accepted migration code unchanged and remove only
   esbuild's avoidable ASCII escaping of existing Unicode literals.
2. Risk: a macOS-only measurement could pass while Linux remains over budget.
   Mitigation: record local directional measurements but require an exact Linux
   production-style assembly/CI result with adequate headroom.

## Tasks

1. Reproduce and attribute the failing bundle graph against the pre-merge base.
2. Remove the smallest behavior-preserving bundle-emission overhead and update
   the exact budget boundary proof.
3. Run focused tests, package typechecks, CLI bundle unit/parity proof, and exact
   production Linux bundle measurement.
4. Commit, open the PR with the complete deployment disposition, run specialist
   and final ReviewGPT gates with CI, resolve findings, and archive this plan.

## Decisions

- The size cap is a regression guard, not release configuration; it will not be
  raised to admit this failure.
- Exact same-host builds attribute the entire 7,993-byte public graph increase
  to the intended Core/Junction migration. The private managed-runtime overlay
  adds 6,889 bytes and turns that public result into the 1,133-byte production
  overage; deleting migration logic for that little margin is unsafe.
- Native UTF-8 output removes 51,325 bytes of ASCII-escape expansion without
  changing entry size, static closure, graph topology, or runtime behavior. The
  cap is lowered to the 9,340,623-byte exact public Linux baseline plus 32 KiB
  ordinary graph allowance plus 8 KiB managed-runtime reserve.
- This is an internal release/reliability correction with no Product UX or
  frontend surface change.

## Verification

- Commands to run: focused Core/Junction tests and typechecks selected from the
  verification map; `apps/cloudflare` runner-bundle CLI tests; production-style
  runner assembly on Linux; exact-head PR CI and ReviewGPT.
- Expected outcomes: all behavioral suites pass, the Linux total is safely below
  9,381,583 bytes, static startup budgets remain green, and review finds no
  unresolved actionable issue.

## Evidence

- Same-host full assemblies measured 9,383,955 bytes before the accepted
  Junction migration and 9,391,948 bytes after it: an exact 7,993-byte delta,
  concentrated in the existing Core mutation input with no dependency or graph
  topology change.
- Murph Cloud's private managed-runtime materialization adds 6,889 bundled
  bytes, yielding the observed 9,398,837-byte production bundle and 1,133-byte
  violation of the former cap.
- Native UTF-8 output measures 9,340,623 bytes, a 51,325-byte reduction. The
  entry remains 671 bytes and the static closure remains 24,950 bytes.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-bundle-cli-bundle.test.ts`: 14 tests
  passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `node --test scripts/check-runner-bundle-budget-ci.test.mjs`: 7 tests passed.
- `MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=4 pnpm --dir apps/cloudflare
  runner:bundle`: passed the lowered total cap, both startup caps, and all eight
  bundled/unbundled CLI parity probes.
- Exact private materialization on reviewed head
  `4f8f19bf45460fac569d8fa2af3b6bfd0b522e7f` measured 9,345,345 bytes,
  with a 671-byte entry and 24,950-byte static closure. All eight parity probes
  and the private runner verifier passed, resolving the preliminary coverage
  specialist finding with 36,238 bytes of real production margin.
- Final ReviewGPT round 1 passed with no findings. The preliminary specialist
  pass marked only the private execution proof above; no patch was returned.
- Canonical Ubuntu production runner bundle-budget CI passed on the reviewed
  head.
- `pnpm exec prettier --check ...` could not run because Prettier is not a
  repository dependency; `git diff --check` passed.
Completed: 2026-08-20
