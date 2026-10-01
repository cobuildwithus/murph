# Remove unreachable gateway projection cache

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Delete the unreachable Cloudflare gateway projection cache, its private
  helpers, and the test suite that exercises only that unused state owner.

## Success criteria

- No production, package-export, dynamic-path, active-plan, or open-PR
  consumer remains for the deleted subsystem.
- Cloudflare source typechecks and its focused surviving gateway/runtime tests
  pass after deletion.
- The final diff contains only the four scoped deletions and this archived
  execution plan.

## Scope

- In scope: `apps/cloudflare/src/gateway-projection-cache.ts`,
  `apps/cloudflare/src/gateway-projection-cache-permissions.ts`,
  `apps/cloudflare/src/structured-json.ts`, and
  `apps/cloudflare/test/gateway-projection-cache.test.ts`.
- Out of scope: the active gateway projection contracts in
  `@murphai/gateway-core`, runner-store caches, Durable Object state, package
  exports, deployment configuration, and user-facing behavior.

## Constraints

- Technical constraints: preserve every active Cloudflare runtime and gateway
  owner; make no replacement abstraction.
- Product/process constraints: use focused PR-bound proof, preserve unrelated
  work, and commit without pushing or opening a pull request in this task.

## Risks and mitigations

1. Risk: a string-based loader or package subpath could bypass static imports.
   Mitigation: search symbols, filenames, package exports, TypeScript path maps,
   build scripts, active plans, and open pull requests before deletion.
2. Risk: deleting shared helpers could affect another Cloudflare owner.
   Mitigation: independently prove both helper files have no consumer outside
   the unused cache and its dedicated test, then run Cloudflare typecheck.

## Tasks

1. [x] Re-prove branch ownership, cleanliness, reachability, and overlap.
2. [x] Delete the unreachable cache, private helpers, and dedicated tests.
3. [x] Run negative-reference checks and focused Cloudflare verification.
4. [x] Inspect the diff and privacy boundary, archive this plan, and create one
   scoped commit.

## Decisions

- Treat this as a pure complexity collapse: no active behavior or contract is
  replaced because the subsystem has no production entrypoint.
- Keep the surviving serialized-lock owner and its focused tests; it remains in
  use by active runner caches outside this deletion.

## Verification

- Negative symbol, filename, package-export, dynamic-path, active-plan, and
  open-PR searches returned no consumer or overlap.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/serialized-lock.test.ts` passed two tests.
- `pnpm --dir apps/cloudflare build` passed.
- The dependency link reused the offline shared store. Its repository prepare
  hook was skipped after waiting on an already-tracked shared hook lock; this
  deletion has no generation step, and both typecheck and build passed from the
  resulting workspace.
Completed: 2026-08-30
