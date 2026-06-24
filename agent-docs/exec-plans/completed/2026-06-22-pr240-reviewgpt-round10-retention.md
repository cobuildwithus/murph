# PR 240 ReviewGPT round 10 retention fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve ReviewGPT round-10 findings for PR 240 with minimal changes inside
  the existing checkpoint, parser, and rebuild owners.

## Success criteria

- A committed hosted workspace checkpoint response cannot be failed by
  post-CAS cleanup.
- Hosted parser setup failure does not leave unclaimed pending jobs that protect
  raw media forever.
- Local rebuild and doctor recovery recreate parser work by default, while the
  hosted sidecar still avoids creating undrained parser jobs.
- Focused tests and required verification pass.

## Scope

- In scope:
  - Cloudflare direct-R2 snapshot completion cleanup after checkpoint CAS.
  - Hosted conversation parser drain setup-error behavior.
  - Inbox service rebuild parser-job replay defaults and hosted sidecar override.
  - Focused regression tests.
- Out of scope:
  - New schedulers, queues, databases, lifecycle services, or retention owners.
  - Broad parser pipeline redesign.

## Constraints

- Default to deletion and radical simplicity.
- Preserve web as the canonical hosted workspace checkpoint owner.
- Keep hosted foreground priority and retention privacy guarantees intact.
- Do not expose local identifiers or secret material in committed artifacts.

## Progress

- Registered the round-10 scope.
- Implemented round-10 fixes:
  - Post-CAS Cloudflare snapshot cleanup is best-effort after the committed
    checkpoint and matching snapshot ref.
  - Hosted parser setup/drain failure claims and fails still-pending parser jobs
    for the capture.
  - Local rebuild/doctor defaults parser job replay on, while hosted sidecar
    passes replay off.
- Accepted local deep-review finding that parser replay must not re-enqueue work
  for attachments already hydrated from successful parser manifests; fixed the
  enqueue predicate and added direct inboxd proof.
- Accepted follow-up deep-review findings that local rebuild/doctor must not
  preserve stale `running` parser jobs when parser replay is enabled, and hosted
  parser setup must not miss a pending media job hidden behind legacy non-media
  jobs; fixed both at the existing parser-job owners with focused proof.
- Accepted a final local deep-review finding that stale/unclaimable parser rows
  must not pin raw media forever; restricted retention parser-job protection to
  fresh active audio/video jobs and added regression proof for stale legacy rows.
- Accepted a coverage-write finding that running parser jobs also need
  `startedAt` freshness proof; added direct retention coverage for fresh and
  stale `running` audio parser jobs.

## Verification

- Required local audits completed:
  - `coverage-write`: accepted one test-only proof gap for fresh/stale
    `running` parser jobs and added the focused regression.
  - `security-privacy-review`: no blocking medium-or-higher findings.
  - `deep-review`: no blocking findings; residual tradeoffs are the intentional
    best-effort post-CAS cleanup and explicit replay/rebuild recovery for
    hosted parser outages.
- Passed focused checks:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-conversation-event.test.ts hosted-runtime-context-coverage.test.ts`
  - `pnpm --dir packages/inbox-services test -- service-layer-coverage.test.ts inbox-services-core-seams.test.ts inbox-app-bootstrap-doctor.test.ts`
  - `pnpm --dir packages/inboxd test -- inbox-media-retention.test.ts idempotency-rebuild.test.ts`
- Passed broad checks on the final diff:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff ...`
  - `pnpm docs:drift`
  - `pnpm --dir packages/contracts test:artifacts`
  - `git diff --check`
  - `pnpm test:smoke`
Completed: 2026-06-22
