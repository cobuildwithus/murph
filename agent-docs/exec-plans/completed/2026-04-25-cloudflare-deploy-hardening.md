# Harden Cloudflare deploy validation, smoke, and retry caps

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Land the requested Cloudflare hosted execution deploy hardening follow-up so deploys cannot silently pass with stale runner/container behavior, invalid runner-output failures are bounded, deploy artifacts fail closed on stale config/secrets or skip-build bundles, raw deploy args stay safe, and smoke version pinning is not treated as proof without direct evidence.

## Success criteria

- Regression tests cover the five reported gaps.
- Focused Cloudflare verification passes.
- Required completion-workflow audit passes complete.
- A scoped commit lands and is pushed.
- `pnpm cf:deploy` completes successfully.

## Scope

- In scope:
  - `apps/cloudflare` deploy artifact generation/validation, smoke, worker deploy helper, runner retry behavior, and directly coupled docs/tests.
  - `apps/web` hosted-run acquisition attempt accounting where required to make the Cloudflare retry cap enforceable across failed same-cursor runs.
- Out of scope:
  - Hosted web signup/auth flow changes unless a Cloudflare test proves a direct dependency.
  - Real production data cleanup outside deploy/runtime scripts.

## Constraints

- Technical constraints:
  - Preserve the narrow Worker HTTP surface and web-owned hosted-run recovery authority.
  - Do not expose secrets or local identifiers in logs, tests, docs, commits, or deploy output.
  - Avoid weakening deploy/runtime invariants to satisfy smoke or tests.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared worktree.
  - Use `scripts/finish-task` for the scoped commit.

## Risks and mitigations

1. Risk: Deploy smoke can still miss real runner/container execution if no smoke user is configured.
   Mitigation: Add a signed deploy-only managed-container smoke route and enable it in the hosted deploy workflow.
2. Risk: Artifact validation compares stale outputs to stale outputs.
   Mitigation: Add manifest provenance for skip-build assembly and compare generated deploy config/secrets against the current environment render.
3. Risk: Retry caps accidentally quarantine replay-safe transient failures.
   Mitigation: Apply the cap to normal runner-output retry scheduling and keep existing authoritative-input quarantine behavior intact.

## Tasks

1. Inspect current deploy/smoke/retry/artifact behavior against the five reported findings.
2. Add focused failing regression tests for gaps that are not already covered.
3. Implement minimal production/script changes.
4. Run focused verification and required audit passes.
5. Commit, push, deploy, and report the result.

## Decisions

- Treat `Cloudflare-Workers-Version-Overrides` as a routing hint rather than sufficient proof; smoke should verify direct Worker-version evidence when the runtime exposes it.
- Preserve the previous `--dry-run` fail-closed wrapper fix and extend around it only if coverage shows a remaining hole.
- Enforce runner-output retry caps by incrementing new hosted-run attempts for failed same-cursor runs in `apps/web`, then quarantining invalid runner-output failures at the configured Cloudflare attempt limit.

## Outcomes

- Implemented version metadata binding and response assertion for pinned smoke.
- Added deploy-signed `/internal/deploy/container-smoke` and runner-bundle manifest fingerprint comparison.
- Changed container rollout to all-at-once with zero active grace so old container code is not intentionally kept serving after deploy.
- Extended deploy artifact validation to compare generated config/secrets with the current deploy env, reject skip-build bundles, and fingerprint package assets beyond `src`.
- Preserved and re-verified fail-closed deploy wrapper argument parsing for `--dry-run`.
- Added runner-output invalid archive quarantine at `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS`.

## Verification

- Commands to run:
  - Focused Vitest for changed Cloudflare deploy/runtime tests.
  - `pnpm --dir apps/cloudflare verify`
  - `bash scripts/workspace-verify.sh test:diff <changed paths>`
  - `git diff --check`
  - `pnpm cf:deploy`
- Expected outcomes:
  - All focused/app-level checks green.
  - Any unrelated root-level blockers are named explicitly if encountered.

- Completed:
  - Focused Cloudflare regression suite: 11 files / 203 tests passed before audit fixes.
  - `pnpm --dir apps/cloudflare verify`: 61 files / 594 tests passed after audit fixes.
  - `pnpm --dir apps/web typecheck`: passed.
  - Focused `apps/web/test/hosted-run-store.test.ts`: 24 tests passed.
  - `bash scripts/workspace-verify.sh test:diff ...`: passed; web lint/build emitted pre-existing warnings only.
  - `pnpm typecheck`: blocked by pre-existing `packages/assistant-engine/test/assistant-cli-tools-capabilities.test.ts` unknown `protocols` issue.
Completed: 2026-04-25
