# Fix hosted-local runner bundle total budget

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Keep hosted-local E2E bundle preparation from failing on a stale absolute
  lazy-output ceiling while preserving fail-closed startup-shape limits and
  exact-base CI protection against material total-output growth.

## Success criteria

- Production assembly continues to enforce entry bytes, static boot-closure
  bytes, static chunk count, forbidden boot inputs, and the boot probe.
- Local and hosted-local assembly no longer depend on a manually ratcheted
  absolute total-output ceiling.
- The existing exact-base CI comparison measures the vault CLI and bundled
  runner entrypoint output surfaces independently and fails closed when either
  is absent, malformed, or grows beyond its relative allowance.
- Focused unit tests, script contract tests, relevant typecheck, and a direct
  production assembly prove the changed boundary.

## Scope

- In scope: runner entrypoint assembly budgets, the existing exact-base bundle
  comparison script and its tests, and the durable testing/CI ownership map.
- Out of scope: hosted runtime behavior, bundle contents, Docker image behavior,
  workflow trigger/permission changes, dependencies, and production deployment.

## Constraints

- Technical constraints: retain all startup-path and externalization guards;
  compare each independently emitted output root instead of hiding regressions
  in one combined total; keep the existing 1%-or-96KiB relative policy.
- Product/process constraints: authority remains the exact committed Frog entry
  for #2513; published evidence must be public-safe and the PR must stay draft
  until focused proof and candidate review are complete.

## Risks and mitigations

1. Risk: Removing the local total ceiling could leave lazy output unbounded.
   Mitigation: extend the required exact-base CI owner to the runner entrypoint
   output root before removing local enforcement, with missing-output tests.
2. Risk: A broad total comparison could mask growth in one output surface with
   shrinkage in another.
   Mitigation: compare vault CLI and entrypoint roots independently.
3. Risk: Refactoring budgets could weaken cold-start safeguards.
   Mitigation: leave entry, static-closure, chunk-count, forbidden-input, and
   real-artifact boot-probe gates unchanged and retain their boundary tests.

## Tasks

1. Add focused failing tests for locally accepted lazy-only growth and exact-base
   CI rejection of entrypoint-output growth.
2. Move total-output ownership to the existing relative CI comparator while
   preserving local startup budgets and diagnostics.
3. Update the durable verification map and run focused plus direct proof.
4. Inspect the final patch, commit through the plan workflow, open the draft PR,
   and complete exact-head review/CI/landing gates if the scope stays low risk.

## Decisions

- Treat the CLI `.bundle` and runner `dist-bundled` roots as separate measured
  surfaces because they are independently emitted and a shrink in one must not
  subsidize growth in the other.
- Keep total bytes as assembly diagnostics, but make exact-base CI the sole
  total-growth policy owner; startup budgets remain local because they protect
  cold-start shape directly at assembly time.

## Verification

- Commands to run: focused Vitest for entrypoint bundling; Node script contract
  tests; relevant Cloudflare typecheck; direct production runner assembly;
  diff/complexity/privacy checks.
- Expected outcomes: all pass; direct assembly reports total bytes without an
  absolute total ceiling; exact-base fixtures reject either surface one byte
  beyond its allowance.
- Completed:
  - focused entrypoint Vitest: 43 passed;
  - CI comparator Node tests: 14 passed, including independent entrypoint growth
    and missing-surface failure;
  - Cloudflare typecheck: passed;
  - `pnpm complexity:diff`: passed with no hotspots;
  - agent-docs drift and `git diff --check`: passed;
  - full production runner assembly: passed, retaining entry/static/chunk
    budgets and reporting the runner total under the exact-base CI guard.
Completed: 2026-09-02
