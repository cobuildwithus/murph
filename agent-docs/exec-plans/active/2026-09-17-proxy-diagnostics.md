# Diagnose and repair hosted proxy and execution failures

Status: active
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

Focused proof passed: 381 Cloudflare Node tests across five affected owners, 30 hosted-execution observability tests, 11 real Workers socket tests, both affected typechecks, and complexity review. Workers tests also emit internal disconnect diagnostics in intentionally disrupted socket scenarios; a passing suite does not establish the production vendor-error cause. The existing fresh-checkout Prisma-generation prerequisite was satisfied. Production diagnosis and release remain pending.
