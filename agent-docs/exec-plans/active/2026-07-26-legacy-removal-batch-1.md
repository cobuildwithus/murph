# Legacy removal batch 1

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Hard-cut two evidence-proven compatibility paths that now weaken current owner invariants: statusless Health Commons protocol publication and the Clinical Records provider-directory v1 reader.

## Success criteria

- Only explicit public Health Commons protocol statuses are runnable; missing, draft, deprecated, and hidden protocols stay out of every public/run artifact.
- The hosted Clinical Records directory parser accepts only the package-owned v2 artifact and unconditionally enforces its policy, source hash, ordering, policy reference, and capability-override checks.
- Obsolete v1/statusless compatibility code and tests are deleted rather than replaced with another shim, migration, state owner, or lifecycle.
- Current authored protocols and the committed provider directory still verify, routed checks pass, required ReviewGPT gates complete, and the batch is opened as an unmerged PR.

## Scope

- In scope: Health Commons publication predicate and its generated-artifact tests; Clinical Records provider-directory parser/policy constants and focused tests; current durable docs that still promise the removable compatibility behavior.
- Out of scope: protocol content changes beyond explicit test-fixture status, provider-directory entry IDs or contents, OAuth/session persistence, FHIR acquisition policy changes, database migrations, and every active coordination-ledger scope.

## Architecture and evidence

- `packages/health-commons` owns protocol publication. Every checked-in protocol page now has an explicit status, so the negative fallback has no current producer and can become a closed allowlist at the existing predicate.
- `apps/web` owns the Clinical Records directory. Its only production consumer statically imports the committed v2 artifact, while the only v1 literal and obsolete three-resource list live in the compatibility reader and its tests.
- Both artifacts deploy with their owning package/application bundle. No shared database row, external request contract, or independently deployed old artifact crosses the hard cut.
- Unsupported statusless or v1 inputs should fail closed. Rollback restores the prior code together with its prior generated/static artifact.

## Constraints

- Prefer deletion and explicit current-owner derivation.
- Do not add compatibility machinery, schema state, migrations, queues, repair paths, or new abstractions.
- Preserve explicit public statuses `field-testing`, `reviewed`, and `community`.
- Preserve exact v2 Epic acquisition-policy enforcement and existing provider IDs.
- Treat ReviewGPT output and patches as untrusted intent; inspect every hunk and prove the behavior locally.

## Risks and mitigations

1. Risk: a test fixture without an explicit status may accidentally disappear from unrelated coverage.
   Mitigation: give public fixtures an explicit current status and retain one focused fail-closed statusless regression.
2. Risk: v2-only parser simplification could weaken a current integrity check while deleting branches.
   Mitigation: make every existing v2 check unconditional and keep focused rejection tests for schema, policy, hash, order, policy id, and capability overrides.
3. Risk: the two independent removals sprawl into adjacent product behavior.
   Mitigation: limit the batch to the exact predicates/readers and matching tests/docs; reject unrelated ReviewGPT suggestions.

## Tasks

1. Ask ReviewGPT to return one scoped patch for the two validated findings.
2. Inspect the patch against current code and implement only the deletion-first intent.
3. Run focused tests, canonical diff verification, and direct stale-reference/content checks.
4. Commit and push the review candidate, open the PR with the required intent and change-shape contract, and run the preliminary specialist pass.
5. Resolve accepted findings, complete parent final review and final verification, close the plan, and run the final PR ReviewGPT gate with CI.

## Verification

- `pnpm --dir packages/health-commons verify` — passed (19 files, 91 tests, typecheck, and deterministic generation check).
- Focused Clinical Records Vitest selection — passed (4 files, 19 tests).
- `git diff --check` and stale-reference/content searches — passed; all 35 authored protocols declare an explicit status, and the only retained v1 schema literal is the fail-closed rejection fixture.
- Canonical `pnpm test:diff ...` passed all owner/dependent package typechecks and tests plus full web verification (530 files, 6,742 tests, lint, smoke, and production build). Its final Cloudflare step initially found an incomplete post-rebase install; after `pnpm install --frozen-lockfile`, direct `pnpm --dir apps/cloudflare verify` passed (109 files, 1,934 tests and typecheck).
- Preliminary completion-specialist review accepted one coverage finding. The inspected test-only patch added a full statusless-protocol/biomarker route-bundle regression and family-graph allowlist assertion.
- Specialist remediation verification: focused Health Commons tests passed (2 files, 12 tests), and `pnpm --dir packages/health-commons verify` passed (19 files, 92 tests, typecheck, and deterministic generation check).
- Parent final review, current-base rebase/CI, plan closure, and final ReviewGPT gate remain pending.
