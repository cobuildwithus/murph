# Diagnose and repair hosted proxy and execution failures

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Preserve actionable, content-free diagnostics and repair proven failures in OpenAI proxy requests, processing-command deadlines, execution deadlines, and replica writes. Validate the release against fresh production observations.

## Success criteria

- Socket completion and closure metadata survive structured-log sanitization; bounded diagnostic writes retain their request lifetime.
- Processing timeouts identify the failing operation and preserve the authoritative runtime owner while requesting a bounded retry.
- Replica admission failures retain their finite control-plane reason and never admit unauthorized writes or bypass cleanup.
- Focused regression tests, relevant typechecks, parent review, exact-head CI and required ReviewGPT pass before release.
- Deploy the authorized candidate through the hosted workflow and compare bounded metadata-only production evidence; distinguish unresolved vendor failures from repaired defects.

## Scope and owners

Cloudflare owns the transport and execution adapter. Web/Postgres remains the runtime and resource authority. The existing structured logger and runtime-log database remain lossy observability, never correctness state. No new retry queue, scheduler, authority store, payload logging, or deadline expansion.

## Evidence and decisions

- A synthetic completed Responses exchange loses terminal and close fields at the structured logger's 32-key limit. Expand the bounded object limit and prove redaction still applies.
- The installed Containers SDK omits waitUntil from outbound-handler context. Use Cloudflare's request-scoped waitUntil for best-effort diagnostic persistence only.
- Postgres processing lets budget expiry escape instead of returning its existing retry response. Preserve ownership and diagnose the exact failed step.
- Replica commands discard the Web error code. Retain only recognized metadata and prove no storage effect follows rejected admission.

## Product UX

- Outcome: preserve ongoing work through temporary processing deadlines and expose accurate transport outcomes.
- Reaches: existing hosted execution and replica publication; no new member interaction or provider input.
- Proof: synthetic deadline, ambiguous acknowledgement, admission rejection and socket completion journeys, followed by bounded production observation.

## Risks and deployment

Keep provider forwarding, accounting, authority checks, and cleanup ordering intact. Do not infer that an opaque transport error means a failed assistant request. Existing Web and container contracts remain supported; additive Worker diagnostics require no schema migration. Further behavior changes require evidence and a compatible release plan. Rollbacks require separate explicit authority.

## Tasks

1. Reproduce missing diagnostics and failure handling through composed owners.
2. Apply the smallest fixes and run focused tests and typechecks.
3. Review, commit, push a draft PR, start required ReviewGPT concurrently with exact-head CI once ready.
4. Deploy through the existing hosted workflow, inspect fresh traces for all four classes, and repair any newly proven causes.
5. Record public-safe verification outcomes and close this plan when the authorized work is complete.

## Verification

Use focused Cloudflare Node and Workers tests, hosted-execution sanitization tests, package/app typechecks, and complexity review. Production proof uses bounded Cloudflare observations plus read-only control/runtime SQL; no production rows or identifiers enter this plan, fixtures, logs, or PR text.

## Implementation checkpoint

The initial candidate expands sanitized details to 64 keys, keeps four ordinary plus one terminal diagnostic write in flight, uses request-scoped background retention, reports processing-step failures, preserves ownership on timeout, and returns recognized replica conflicts without a proxy exception. It adds no provider calls, authority bypass, or deadline extension.

Focused proof passed: 381 Cloudflare Node tests across five affected owners, 30 hosted-execution observability tests, 11 real Workers socket tests, both affected typechecks, and complexity review. Workers tests also emit internal disconnect diagnostics in intentionally disrupted socket scenarios; a passing suite does not establish the production vendor-error cause. The existing fresh-checkout Prisma-generation prerequisite was satisfied. The initial release subsequently passed production smoke and convergence checks.

The first external review passed. Subsequent base integrations preserve accepted socket queue telemetry and runtime wake diagnostics. Timeout retries now populate the existing command-budget or container-timeout reason in the shared request-local context. CI identified one cross-package assertion of the obsolete 32-field truncation; it now proves complete sanitized field retention. Focused integration proof passed: 206 assistant-runtime tests, 96 Cloudflare tests, both affected typechecks, and complexity review. The second full-snapshot review and exact-head CI passed before deployment.


## Deployed follow-up

The initial fix passed both external review rounds, exact-head CI, hosted deployment smoke and convergence checks. Fresh observation confirmed a timed-out acknowledgement preserved its invocation owner and later completed. Opaque proxy errors still require careful correlation; their presence alone does not establish failed delivery. Idle-expiry health timeouts already preserve the container and schedule reevaluation.

The deployed diagnostics exposed another reproducible observation defect: the 64 KiB upstream inspection limit misses valid large acknowledgement and terminal frames. Missing a prewarm terminal also makes later socket reuse appear ambiguous. A synthetic large-frame relay test fails on the deployed code. Align upstream inspection with the existing bounded 6 MiB request inspection budget and reuse that parse for first-frame classification, removing the duplicate JSON parser. No provider payload is retained in diagnostics; forwarding and accounting remain unchanged. Run the composed relay tests, typecheck, complexity review, external review and CI before the follow-up release.

Follow-up focused proof passed: 42 relay tests, 11 real Workers tests, Cloudflare typecheck and complexity review with no hotspots. Full-snapshot external review and exact-head CI passed before merge. The authorized hosted deployment passed smoke and convergence at full traffic, retaining member images and capacity.

## Outcome and verification limits

- Initial release: PR #3539, reviewed head `d71e53f4f56c6c82ce7af41303413fd25dd3dc07`, merged as `2d0a625d265f40fec756d272bf45329b1b6c62a1`.
- Large-frame follow-up: PR #3542, reviewed head `bc19548b253fef6b7bd6ce5886548f83425c0c32`, merged as `904b8a566de6b6f5b85a1511775a5022dcb985e9`.
- Both releases completed the protected hosted deployment workflow. The follow-up required one same-head retry of a scheduled-reminder gate that returned a generic runtime error; all assertions and gates remained enabled. The synthetic artifact omitted the underlying exception, recorded in the task-owned Frog entry. A passing retry does not establish that failure's cause.
- Bounded production observation verified timeout ownership recovery and persisted socket-close metadata. Correlated opaque proxy errors included completed invocations and successful delivery outcomes; raw error counts alone do not prove failed OpenAI requests or authentication failures.
- The final follow-up window contained accepted processing and completed invocation records, but no fresh large-frame socket or replica-conflict sample. Large-frame correlation and finite replica reasons are proven by focused tests; live validation of those specific cases remains unobserved in that window.
- Cloudflare's opaque references do not expose platform-internal causes through the available diagnostic API. The release improves evidence and repairs demonstrated application defects; it does not claim to eliminate every platform transport error.

The application fixes, bounded logger expansion, regression proof, review, deployment and post-deploy comparison are complete. No payload logging, additional execution authority, rollback, or new recovery owner was introduced.
Completed: 2026-09-17
