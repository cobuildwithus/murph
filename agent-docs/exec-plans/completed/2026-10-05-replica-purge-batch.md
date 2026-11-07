# Complete replica cleanup within the control request deadline

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Complete deletion of a retired replica and its finite sibling set through the existing control request so Web can durably acknowledge the purge. Preserve namespace authority, terminal retirement, publication fences, and rejection on uncertain deletion.

## Evidence and owner

The Web cleanup owner uses a five-second control request. The Worker deletes the root and every derived sibling serially. A synthetic 200 ms binding operation makes the 36-key set take 7.2 seconds, exceeding that caller deadline even when every deletion succeeds. Production observation supports this mechanism; confidential trace details remain outside repository artifacts.

Postgres owns retirement and purge acknowledgement. The existing Worker route owns the validated physical deletion. Cloudflare's documented R2 binding accepts up to 1,000 keys per delete call, so the existing finite replica set fits one native operation.

## Success criteria

- A delayed synthetic R2 binding completes the entire replica set through the actual control client within its unchanged deadline.
- Wrong-member and nested keys remain rejected before R2 access.
- Provider rejection propagates; no false success or new retry policy.
- Focused tests/typecheck, parent review, final ReviewGPT, and required exact-head CI pass.
- Functional PR remains unmerged for human approval; no production writes.

## Scope

Change only the replica physical deletion shape, focused proofs, and the existing upload/deletion owner documentation. Snapshot, media, multipart and legacy paths retain their contracts. No schema, configuration, timeout, scheduler, or telemetry infrastructure change.

## Risks and mitigations

Batch deletion changes provider invocation shape. Validate against the official binding contract, prove the complete exact key set and propagated rejection, and exercise the Workers binding where practical. Keep the bounded key derivation and existing authority checks.

## Tasks

1. Obtain implementation from ReviewGPT using synthetic context.
2. Run the new regression against the baseline, apply and inspect the production patch, and prove the corrected outcome.
3. Complete relevant local verification and candidate review, then open a scoped PR.
4. Run final ReviewGPT concurrently with required CI; retain unresolved production outcome queries.

## Decisions

Use the native bounded R2 batch primitive instead of extending the deadline or adding retries. No user-facing flow changes; Product UX is not applicable to this internal cleanup correction.

## Verification

ReviewGPT authored the two-line production correction; the parent added the composed control-client regression and actual Workers binding proof. The new deadline case returns TimeoutError against the sequential baseline. Baseline focused suite: 2 failed / 3 passed (the other failure is the changed call-shape expectation). Corrected Node suite: 5 passed. Actual workerd R2 binding proof: 1 passed, including missing siblings, repeat deletion and foreign-namespace preservation. Final Cloudflare typecheck, docs drift and diff whitespace checks passed. Complexity passed with maximum 14 to 13 and no changed-source hotspot above 20. Final ReviewGPT and required exact-head CI remain PR completion gates. Production deployment and exact purge acknowledgement verification require later functional merge authority.
Completed: 2026-10-05
