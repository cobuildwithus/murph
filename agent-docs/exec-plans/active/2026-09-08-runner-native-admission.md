# Restore actionable native runner admission failures

Status: active
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
