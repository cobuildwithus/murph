# Codex cold restore lifecycle

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Prevent a warm Codex App Server from retaining local database state across a cold hosted workspace replacement, so accepted messages resume without delayed recovery.

## Success criteria

- Production evidence and a production-faithful reproduction identify the lifecycle boundary that caused the regression.
- Every workspace restore stops the engine-owned warm Codex process before replacing or sanitizing its storage.
- Warm checkpoint reuse preserves its no-R2 fast path while a fresh process owns the sanitized Codex home.
- Focused tests prove cold and warm ordering, recovery, and fail-closed behavior.
- Required package checks, specialist review, final review, CI, production deployment, and post-deploy checks pass.

## Scope

- In scope: hosted workspace restore lifecycle, focused regression coverage, owning architecture/reliability contracts, and a privacy-safe changelog item.
- Out of scope: snapshotting Codex SQLite files, new retry machinery, provider or mailbox changes, and unrelated runtime cleanup.

## Constraints

- Technical constraints: assistant-engine remains the sole Codex process owner; snapshot contents remain limited to portable state; no process may use storage while that storage is replaced.
- Product/process constraints: preserve accepted-message durability, keep the member reply path available, avoid private incident evidence in repository artifacts, and use the Cloudflare runner PR/deployment lane.

## Risks and mitigations

1. Risk: stopping Codex at each restore boundary gives up process reuse between workspace invocations.
   Mitigation: keep the no-R2 warm-checkpoint fast path and process reuse within one restored workspace; never trade correctness for a process spanning two filesystem lifecycles.
2. Risk: stopping after the filesystem mutation could leave background database work attached to replaced storage.
   Mitigation: make teardown an explicit predecessor of every destructive restore branch and test event ordering.
3. Risk: a narrow error retry could hide another lifecycle violation.
   Mitigation: correct the storage-owner boundary and do not add error-string recovery logic.

## Tasks

1. Complete root-cause proof from production lifecycle evidence and production-image A/B runs.
2. Add the smallest teardown call at the Cloudflare container invocation boundary before it delegates to workspace restore.
3. Add deterministic boundary coverage and a pinned-Codex cold-restore journey.
4. Update owning lifecycle documentation and the public outcome changelog.
5. Run focused tests, typecheck, candidate review, ReviewGPT, and required CI.
6. Merge, deploy the exact reviewed runner head, and prove post-deploy health and reply recovery.

## Decisions

- Codex SQLite remains rebuildable machine-local state and is not added to hosted snapshots.
- No stale-resume retry or legacy-history override is added; both would treat a symptom instead of correcting lifecycle ownership.
- The Cloudflare container owns restore sequencing and calls the existing engine lifecycle hook; assistant-runtime remains independent of the concrete assistant-engine lifecycle.

## Verification

- Commands to run: focused assistant-runtime/Cloudflare Vitest coverage, affected package typechecks, production-image cold-restore journey, PR checks, and post-deploy runtime/latency queries.
- Expected outcomes: teardown precedes cold filesystem replacement and warm sanitization, warm reuse skips R2 restore, preserved rollout resumes on a freshly initialized Codex process, and production shows no matching runtime database error or delayed reply backlog.
