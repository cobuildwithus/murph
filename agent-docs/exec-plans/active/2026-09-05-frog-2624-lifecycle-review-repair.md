# Repair hosted-local lifecycle review findings

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Finish the explicitly resumed PR #2720 lifecycle corrections: suite teardown cancels and joins one setup call, while ordinary stop remains graceful and pending local children cannot escape cleanup.

## Scope and constraints

- Existing scenario, stack, MinIO, and HTTP readiness owners plus focused tests and durable local-tooling documentation.
- Preserve production behavior, exact-child process signaling, bounded retries, and completed historical plans.
- One mechanical merge of current main resolves stale index documentation. No rewritten published history.

## Tasks

1. Prove cancellation/retry and graceful-stop regressions, then keep one setup record per public call.
2. Cancel pending MinIO startup and stack readiness through existing owners; retain exit fallback until cleanup settles.
3. Run focused regressions, typechecks, proportional security/reliability/architecture and complexity audits.
4. Push stable candidate, perform current full ReviewGPT with independently verified timing concurrently with exact-head CI, and follow finding dispositions.
5. If all low-risk landing gates pass, verify actual merged tree before issue closure and sanctioned retirement.

## Decisions

- Both prior lifecycle findings were accepted and explicitly resumed by the user.
- Normal successful scenario stop must not invoke the startup-abort kill path.
- Cancellation stops health polling and exact pending children; graceful cleanup still joins their existing owners.

## Verification

- New regression tests must fail on the resumed baseline and pass after correction.
- Affected Cloudflare helper suites and hosted-local harness runtime/MinIO/stack suites, relevant typechecks, complexity guard, docs drift and privacy checks.
- Current exact-head required CI and current supported ReviewGPT evidence remain landing gates.

## Completed local evidence

- Five new baseline failures reproduced cancelled port retry, ready-scenario abort, unpublished MinIO cancellation under both signals, and early exit-listener release.
- Cloudflare helper suites: 41 tests passed. Hosted-local runtime, MinIO, and stack suites: 119 tests passed, including real HTTP in-flight and retry-delay cancellation.
- Hosted-local harness and Cloudflare package typechecks passed. Complexity guard passed: stack debt remains 119 and maximum remains 139; MinIO/runtime add no debt.
- Parent candidate audit preserves the existing setup/stack/MinIO ownership chain, exact child signaling, normal graceful stop, bounded port retry, and existing container cleanup. No production code, credentials, dependencies, or deployment changes.
- Stable-head external review and required CI are the remaining completion gates; evidence lives with PR #2720.
