# Meal Photo Follow-up Hardening

## Goal

Close the accepted PR #600 review gaps without adding a new queue, receipt
protocol, or durable state owner:

1. Serialize the final upload authority check with enrollment revocation and
   account deletion before the mailbox append commits.
2. Delete staged bytes when that final authority check or append fails.
3. Enforce the metadata-free JPEG contract at the server boundary.
4. Keep temporary encrypted staging recoverable for the mailbox retention
   window while preserving immediate post-import deletion.
5. Document the existing deploy order and rollback floor for the new mailbox
   kind instead of adding permanent compatibility machinery.

## Constraints

- Reuse the existing hosted-member row lock and mailbox owner.
- Keep R2 staging temporary and encrypted; raw JPEG bytes never enter Postgres
  or mailbox payloads.
- Add no new service, queue, state machine, receipt API, or persisted state.
- Preserve exact-duplicate upload replay and post-checkpoint cleanup behavior.
- Keep unrelated worktree and ledger changes untouched.

## Working Set

- `apps/web/src/lib/device-sync/meal-photo-capture.ts`
- `apps/web/app/api/device-sync/companion/meal-photo-capture/photos/route.ts`
- `apps/web/test/device-sync-companion-meal-photo-capture-*.test.ts`
- `packages/cloudflare-hosted-control/src/{client,routes}.ts`
- `packages/cloudflare-hosted-control/test/{client,routes}.test.ts`
- `apps/cloudflare/src/worker/route-handlers/meal-photo-stage.ts`
- `apps/cloudflare/src/worker/internal-routes.ts`
- `apps/cloudflare/test/worker-meal-photo-stage-route.test.ts`
- `apps/cloudflare/r2-bundles-lifecycle.json`
- `apps/cloudflare/test/r2-lifecycle.test.ts`
- `agent-docs/{SECURITY,RELIABILITY}.md`
- `apps/cloudflare/DEPLOY.md`

## Verification Plan

- Focused hosted-web meal-photo validation, enrollment, and route tests.
- Focused hosted-control client/route tests.
- Focused Cloudflare meal-photo store/route and lifecycle tests.
- Truthful scoped coverage plus web and affected package typechecks.
- Required `coverage-write` and `security-privacy-review` completion audits.
- Parent final diff review.
- PR CI plus ReviewGPT reruns until green CI and zero accepted findings.

## State

- Implementation complete.
- Focused web, hosted-control, and Cloudflare tests are green.
- Affected typechecks, workspace typecheck, prepared runtime build, doc
  gardening, and diff hygiene are green.
- The repo-wide acceptance command reached its parallel coverage phase, where
  unrelated existing dev-smoke, assistant-runtime, and CLI timing tests failed
  under local resource contention. PR CI remains the final full-suite proof.
- Required coverage and security/privacy audits completed with no remaining
  medium-or-higher findings or coverage gaps.
- ReviewGPT and PR CI remain as post-push completion gates.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
