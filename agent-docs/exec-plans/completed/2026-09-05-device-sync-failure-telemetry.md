# Preserve bounded ECG failure reasons in hosted telemetry

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Expose the existing closed-vocabulary ECG binding rejection reason in hosted device-sync failure telemetry so operators can distinguish incomplete collections from identity conflicts without reading health payloads.

## Success criteria

- Synthetic hosted failure proof fails on the base and passes with the accepted ReviewGPT patch.
- Existing log sanitization, foreground priority, canonical ownership, retries, and import behavior are unchanged.
- Focused tests, affected typecheck, parent review, final ReviewGPT and required exact-head CI pass.
- Any telemetry deployment follows the existing reviewed production path; record the observation query and retention decision.

## Scope

- In scope: existing hosted failure projection, closed reason metadata, focused proof, owner documentation; read-only wake and failure investigation.
- Out of scope: provider payloads or health/sample values, recovery operations, new state or schedulers, changes to identity validation, retries, credentials, and existing PR-owned checkpoint behavior.

## Constraints

- ReviewGPT authors production implementation and substantive revisions. Local work owns investigation, test-only reproduction, patch application, verification, and Git.
- The device service owns sanitized ECG diagnostics; hosted logging projects that existing fact. No new persistence owner, event stream, provider I/O, or log volume.
- Existing observability retention and event limits apply. Only a finite reason vocabulary is needed; sample/recording counts are excluded.

## Risks and mitigations

- A generic code formatter is not a semantic privacy allowlist: prove unknown/freeform reasons cannot escape.
- Old runners omit the field; absence must remain unknown, not successful recovery.
- A passed sync job or consumed wake alone does not prove each resource imported; keep aggregate and outcome evidence distinct.

## Tasks

1. Reverify current production aggregates and branch ownership; classify aged wakes and failures.
2. Ask ReviewGPT for the smallest diagnostic projection patch plus composed positive/privacy regression proof.
3. Apply accepted patch exactly; prove the base failure and head pass, typecheck and inspect diff.
4. Commit, push, open PR, final ReviewGPT concurrently with required CI; remediate through ReviewGPT if needed.
5. If telemetry deployment is needed and gates permit, deploy exact reviewed change and verify read-only. Preserve bug-fix merge/deployment prohibitions.

## Decisions

- Preserve only the binding reason; no health-related sample counts, values, identifiers, or raw errors.
- Existing idle checkpoint PR retains its owner; this task does not edit that branch.

## Verification

- Baseline: existing maintenance suite 100 tests passed; mailbox-state suite 24 tests passed; assistant-runtime typecheck passed.
- ReviewGPT authored the accepted four-file patch. Its test-only application produced exactly two expected failures for allowed queued/exhausted reasons; the other 109 maintenance cases passed.
- The exact accepted source patch passes 168 maintenance and assistant-phase scheduling tests. Both assistant-runtime and device-syncd typechecks pass.
- Complexity guard passes with unchanged file debt/maxima. Existing orchestration and diagnostic hotspots are unchanged and outside this bounded projection correction. Documentation index updated mechanically to satisfy owner-doc drift validation.
- Parent review: one existing finite set is exported through an existing package entrypoint, with no dependency or owner added. The projection preserves the reason before the shared key cap. Synthetic proof covers normal, exhausted, malformed and wrong-code cases through the existing event parser and shared sanitizer.
- No new developer-friction entry: existing worktree-helper issue remains owned separately.
- Final external review, exact-head CI, merge and any deployment evidence will be recorded in the PR. Deployment observation remains dependent on naturally occurring failures; no replay is authorized.

- Existing hosted-runtime maintenance tests with synthetic failures, assistant-runtime typecheck, complexity guard, documentation drift, diff checks.
- Before: the hosted event omits the service-owned allowed reason. After: an allowed reason survives, and unknown/private fields remain absent.
- Post-deploy: aggregate device-sync.job_failed by the bounded ECG reason over the next 24 hours, with no active replay; retain this low-cardinality field under the existing log retention policy if diagnostically useful.
Completed: 2026-09-05
