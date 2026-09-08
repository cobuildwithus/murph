# Restore actionable native runner admission failures

Status: active — awaiting external account capacity
Created: 2026-09-08
Updated: 2026-09-08

## Goal and invariant

Ship the pending device-sync runner optimization through the protected full release path. Native admission and readiness must finish before Worker activation; serving capacity, member drain, release receipts, and secret isolation remain mandatory.

## Evidence and owner

Two protected full-release attempts stop in the native application POST. The request owner catches HTTP failures and discards status and provider codes. The current request fields and response envelope match pinned Wrangler and the official Containers client. A later Worker-only deployment retains the member image and does not resolve this release.

The actual rejection reason is unavailable in the existing logs. Correct diagnostics at `runner-release-provider.ts` first, then use a protected deployment to establish the cause rather than altering capacity or API behavior speculatively.

## Scope and design

- Preserve bounded HTTP status, operation, numeric API codes and symbolic native error codes at the existing provider boundary.
- Never emit credentials, account/application identifiers, request bodies, response details, or raw transport exceptions.
- Keep Cloudflare authoritative; no new state, retry loop, dependency, quota mutation, or alternate deployment owner.
- Error-path-only changes are compatible with existing Worker and runner releases. Failed preparation leaves the active release selected.

## Tasks

1. Reproduce diagnostic loss with provider-shaped responses and implement bounded diagnostics.
2. Run focused provider/deployment tests, Cloudflare typecheck, complexity guard, and parent review.
3. Push a draft PR, make the stable candidate ready, and run required ReviewGPT with CI.
4. Merge with green exact-head evidence, use the protected full release, and inspect the actionable result.
5. Fix a proven in-scope cause, or report the precise external blocker if it requires new authority; verify the real release before claiming shipment.

## Verification

Eight diagnostic regressions failed before the correction; the initial 55 provider, staging and deployment tests then passed. Cloudflare typecheck and complexity guard passed (no hotspots). Added exact-message privacy assertions and bounded-code coverage before the final focused replay. Request shapes, capacity, no-retry behavior, and admission-before-activation are preserved. Parent review found no additional state or activation-path changes.

Pending: final focused replay, exact-head CI, ReviewGPT and protected production evidence. Production success requires signed smoke and exact release convergence.

## Protected follow-up evidence

The diagnostic correction merged in PR #3041 with 56 tests, typecheck, all required CI and a validated full ReviewGPT PASS. The protected full release then failed earlier in image reuse: a Worker-only release record retains legacy active provenance and a mutable image tag, but the reuse reader checks only the legacy candidate before validating the selected active image as immutable. No new Worker activation occurred.

The smallest correction applies the existing legacy-provenance guard to the selected candidate-or-active release. It must build normally for legacy retained releases in either bank, preserve the serving image and namespace, and retain exact immutable reuse for admitted releases. The original native POST rejection still requires a subsequent protected attempt after this earlier failure is resolved.

The retained-primary regression reproduced the exact production stack before correction. Both bank-direction scenarios pass after correction, including fresh publication, candidate staging, unchanged serving image and serving exclusion. All 65 focused image/provider/staging/CLI tests, Cloudflare typecheck, whitespace and complexity checks pass. Parent review confirms the correction reuses the existing provenance guard and adds no state or capacity change.

## Native rejection evidence

PR #3043 merged with 65 focused tests, green CI and validated ReviewGPT PASS. The next protected attempt passed legacy preparation and reached native application creation, which rejected with HTTP 400 and numeric code 1607. The numeric code has no verified published Containers meaning. The codes-only diagnostic formatter still suppresses the actual explanation, so extend it to bounded messages through the existing public runtime redactor, remove known request credentials/identifiers, and exclude raw response details. No quota or capacity diagnosis is claimed without that evidence.

The bounded-message correction passes all 66 focused provider/image/staging/CLI tests, Cloudflare typecheck, whitespace and complexity checks. Parent review confirms the existing public redactor is reused, successful provider acceptance and request counts are unchanged, and only projected code/message fields are emitted.

## Container enablement ordering

PR #3050 merged with 66 focused tests, 32 passing checks and validated ReviewGPT PASS. The protected full release passed every fresh pre-deployment gate and exposed the actual native rejection: `DURABLE_OBJECT_NOT_CONTAINER_ENABLED`. The inactive namespace exists, but native creation runs before the Worker upload that declares its container class. The earlier Worker-only effective application set excluded the absent inactive application. No capacity rejection is established.

Reorder the existing version upload before native admission while keeping activation after admission and readiness. Revalidate serving authority after upload. Preserve the existing namespaces, migration history, native application specifications, drain, smoke, promotion and receipt gates. No new bootstrap state, API owner, dependency or capacity change. The bounded ordering fixture reproduces the provider rejection before this change; protected production still owns proof that the namespace accepts admission after metadata publication.

The revised deployment sequence passes all 69 focused provider/image/staging/CLI tests, Cloudflare typecheck, whitespace and complexity checks (maximum 8 to 9; no hotspots). Parent review confirms upload and activation reuse the existing commands, with no extra successful-path uploads and no activation on native admission, readiness, drain or authority failure.

## Confirmed quota blocker and handoff

PR #3062 merged with 69 focused tests, Cloudflare typecheck, all 32 applicable CI checks and validated ReviewGPT PASS. The valid review included the exact Wrangler lockfile, local patch and bounded effective upload/deploy source; the first incomplete dependency packet was INVALID and did not count.

The protected release on public commit `a6d32e94ca8171a293b9212a6ebb4bc3fb2b5cc1` passed all fresh pre-deployment gates. Metadata upload completed without activation. Native creation no longer returned the namespace-enablement rejection, but first returned a generic HTTP 500. One retry of the failed production job, retaining the same resolved public and private commits and passing gate evidence, returned HTTP 403/code 1604: the requested inactive application exceeds the account vCPU quota. Both attempts stopped before Worker activation. The device-sync runner optimization remains unshipped.

The configured production overlap is two 648-instance member banks, 100 retained legacy instances and one smoke instance. At 2 vCPUs, 6,144 MiB memory and 6,000 MB disk per instance, this footprint requires at least 2,794 vCPUs, 8,583,168 MiB memory and 8,382,000 MB disk. Other applications in the account require additional headroom. The account's exact custom limits have not been read; the provider's vCPU rejection is authoritative. Do not present Cloudflare's published default limits as measured account limits.

Prepare an external quota request for 3,000 vCPUs and 9 TiB memory, with existing disk quota checked against the overlap footprint and other account applications. This preserves the configured serving ceiling. The request has not been sent: contacting Cloudflare requires explicit user authorization. The existing deployment owner keeps serving ceilings fixed rather than automatically reducing them after quota rejection. No running member container, native serving application, namespace or traffic selector was changed to work around this failure.

After account capacity is available, resume the protected full release against a verified public/private revision, retain the admission and signed-smoke gates, and require exact release convergence. This plan remains active because shipment is still blocked on external account capacity.
