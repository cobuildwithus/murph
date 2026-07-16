# PlanetScale pool lifecycle and Settings read consolidation

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Reduce intermittent hosted-web database connection stalls by giving one
  explicit `pg.Pool` clear Vercel Fluid lifecycle ownership, exposing bounded
  secret-safe failure diagnostics, and removing redundant Settings reads,
  without adding replica routing or speculative retry/tuning machinery.

## Success criteria

- Hosted web creates one reusable `pg.Pool`, immediately registers it with
  Vercel, and passes that same pool to `PrismaPg`.
- Existing deliberate limits (`max: 5`, five-second connection acquisition,
  30-second idle retirement) remain explicit until measurements justify a
  separate tuning change.
- Pool failures report only bounded connection counters and a stable error
  category; no URL, query, member, request, or credential data is logged.
- Settings preserves its rendered behavior while eliminating duplicate
  billing/routing reads and reducing its concurrent database fan-out.
- Prisma and `pg` versions are explicitly audited. Prisma remains on its
  already-current release, and `pg` stays on the single adapter-compatible
  resolved version unless a deduplicated upgrade is proven safe.
- Focused tests, the routed hosted-web verification lane, dependency checks,
  coverage review, CI, and ReviewGPT all pass on the final pushed head.

## Scope

- In scope: hosted-web Prisma/pool construction and tests, the Settings
  server-side data composition and focused tests, `apps/web` dependency
  metadata, lockfile, and narrow operational documentation.
- Out of scope: read-replica clients or auto-routing, pool-size or timeout
  tuning, automatic query retries, schema changes, endpoint secret changes,
  provider-side PgBouncer provisioning, and user-interface changes.

## Constraints

- Technical constraints: PlanetScale application traffic remains compatible
  with transaction-mode PgBouncer; no session-persistent `SET` hooks; direct
  migration traffic remains separate; diagnostics are nonblocking and
  privacy-safe.
- Product/process constraints: smallest maintainable architecture, isolated
  worktree/branch, preserve unrelated changes, scoped commit, PR, then the full
  ReviewGPT loop to zero accepted findings.

## Risks and mitigations

1. Risk: development hot reload creates mismatched clients and pools.
   Mitigation: keep the existing global Prisma client cache, let its adapter
   retain the exact pool, and prove one pool/client across a module reload.
2. Risk: lifecycle registration or logging changes production bundling.
   Mitigation: use Vercel's supported Node helper directly, avoid runtime
   branches, and run hosted-web build/type verification.
3. Risk: Settings consolidation changes authorization or freshness semantics.
   Mitigation: keep the existing owner reads and response shape, remove only
   proven duplicate work, and assert the composed result/call count.
4. Risk: dependency churn obscures the incident fix.
   Mitigation: pin the app to the already-resolved adapter-compatible `pg`
   version, verify constructor identity without a network connection, and keep
   lockfile churn limited to the hosted-web importer.

## Tasks

1. Confirm current PlanetScale, Vercel, Prisma, and repository constraints.
2. Add explicit pool lifecycle ownership and focused diagnostics/tests.
3. Consolidate Settings database reads with behavior-preserving coverage.
4. Add the narrow Vercel runtime dependency, keep the `pg` constructor shared
   with Prisma's adapter, and update runtime documentation.
5. Run focused and routed verification plus required coverage review.
6. Commit, push, open the PR, run CI and ReviewGPT concurrently, remediate all
   accepted findings, and prove the final PR is green and merge-clean.

## Decisions

- Do not add a read replica: production already has HA replicas, and the
  observed failures are client checkout/connection establishment failures, not
  measured primary read saturation.
- Keep current pool limits unchanged in this PR. Lifecycle correctness and
  reduced duplicate work are evidenced; alternative numeric limits are not.
- Do not copy session-level connection setup from the sibling frontend because
  PlanetScale-managed PgBouncer uses transaction pooling.

## Verification

- Commands to run: focused hosted-web Vitest suites during iteration;
  `pnpm test:diff` for the final scoped path set; `pnpm deps:guard`;
  `pnpm deps:audit`; `pnpm deps:ignored-builds`; required coverage-write audit;
  GitHub CI; ReviewGPT PR rounds.
- Expected outcomes: all checks pass, dependency changes are allowlisted and
  audited, coverage has no material gaps, ReviewGPT reports PASS with zero
  accepted findings, and the final head is merge-clean against current main.

## Local evidence

- Focused hosted-web verification passed: four Vitest files and 38 tests,
  including real no-network Vercel registration, Prisma disposal, and shared
  `pg` constructor identity.
- The full hosted-web verifier passed: TypeScript, dev smoke, lint with no
  errors, 5,230 tests, and the production Next.js build.
- Dependency policy and ignored-build checks passed. The registry retired the
  endpoints used by `pnpm audit`, which returned HTTP 410; narrow OSV fallback
  queries found no advisories for the two directly affected package versions.
- The required coverage-write re-audit passed with no remaining material gap,
  and the independent database implementation review found no material or
  merge-blocking issue. Frontend review also passed and confirmed that browser
  proof is unnecessary because no rendered or interactive behavior changed.
- The root `pnpm test:diff` lane passed 368 CLI tests before one unrelated
  release-tarball smoke test timed out under concurrent local load. The scoped
  hosted-web verifier above fully exercised the changed owner.
Completed: 2026-07-15
