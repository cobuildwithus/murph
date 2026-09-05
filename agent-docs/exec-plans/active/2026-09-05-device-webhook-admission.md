# Diagnose and recover device webhook source admission

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

- Restore successful device webhook admission and recover retained encrypted work through the existing Queue consumer.

## Success criteria

- Identify the exact source-readiness boundary responsible for repeated admission failure.
- Verify and deploy the smallest correction, retaining consent and source lifecycle authority.
- Prove that the main Queue drains and the encrypted dead-letter Queue remains empty after recovery.

## Scope

- In scope: source-admission diagnosis, focused correction, existing encrypted redrive, deployment verification.
- Out of scope: provider resets, consent changes, Queue purges, unrelated runtime changes.

## Constraints

- Technical constraints: Web remains the canonical admission owner; Queue messages remain encrypted and only successful canonical admission acknowledges them.
- Product/process constraints: use synthetic fixtures and aggregate diagnostics; production Web deploys through the Git integration and its deployment checks.

## Risks and mitigations

1. Several readiness checks share one error code, so an inferred correction could discard valid pending work.
   Mitigation: add bounded reason counts to the existing batch completion log before changing admission behavior.
2. Recovery can re-exercise an unresolved failure.
   Mitigation: use the documented consumer redrive, preserve the encrypted fallback target, and verify both Queue depths.

## Tasks

1. Compare recent releases and inspect aggregate admission failure evidence.
2. Add privacy-preserving reason counts and focused retry/privacy proof.
3. Verify and deploy diagnostics, identify the exact failing boundary, and reproduce it synthetically.
4. Implement and verify the smallest correction, complete candidate review and required delivery gates.
5. Recover retained encrypted work and confirm Queue convergence.

## Decisions

- The deployed bounded diagnostic identifies the provenance guard. Provider-owned historical completion parsing deliberately omits data-arrival attribution, but hosted admission confuses this with unknown inline data whenever legacy Fitbit remains active.
- Correction: derive a narrowly source-scoped, data-less historical fetch from existing prepared work. Preserve inline/mixed/unknown-source rejection, source lifecycle and consent checks, and migration freshness ownership. No new payload schema or producer deployment is needed.
- Product UX patch: restore bounded history fetching for established wearable sources; cover legacy Fitbit, unrelated connected sources, and Google Health without claiming that a fetch notification proves new data arrived. Prove durable handoff and unchanged unsafe-input rejection with synthetic tests, then separately verify retained Queue admission.
- Diagnostics reuse the existing log owner and never emit arbitrary exception messages, payloads, or event identities.
- No new persistence, queue, admission authority, or retry policy is introduced.
- Changelog: diagnostics were internal-only; the correction adds `wearable-history-fetch-recovery` with the bounded history-sync outcome.

## Verification

- Focused Web batch-admission tests and Web typecheck; complexity and diff checks before commit.
- Expected outcomes: accepted and duplicate dispositions remain unchanged, readiness failures remain retryable, and unknown messages and identifiers remain absent from logs.
- The correction's three historical-fetch cases reproduce the original provenance error before the change. The full hosted wake suite passes 200 tests after it, including mixed-job negative cases. Two provider-owned historical parsing/fetch tests and nine changelog rendering tests pass. Web typecheck passes after refreshing workspace dependencies. Complexity debt drops from 112 to 110 and maximum complexity from 59 to 57; remaining transaction hotspots are unchanged outside the extracted predicate.
- Parent candidate review: existing consent, exact-source registration, connection epoch, encrypted dirty merge, receipt, and mailbox owners remain intact; no provider/KMS I/O or query is added. The pure predicate inspects at most the existing two prepared jobs. Product UX: Ready at the durable-admission boundary; production deployment and Queue convergence remain pending.
- Initial diagnostic candidate: eight focused batch tests passed; Web typecheck passed; complexity guard passed with no hotspots; diff whitespace check passed. Parent review confirms only the existing aggregate completion log changes, with no admission or provider behavior change.
