# Separate container smoke execution and wake responses

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Outcome and invariant

Reduce the container HTTP callback hotspot while preserving request admission, slot ownership, invocation identity, wake state, abort lifetime, response headers and safe diagnostics.

## Design

Extract the independent live-model smoke execution after admission and the terminal wake response serialization into private functions. Keep shutdown, busy rejection, request parsing, wake acceptance and pending-wake mutation in their current owner and order. Helpers receive the same hydrated runtime callback and request signal. No routing, deployment, auth or environment change.

## Verification

Container entrypoint and abort HTTP suites, Cloudflare package typecheck, complexity and source equivalence review. Publish a scoped PR and begin ReviewGPT concurrently with CI. Existing synthetic heavy runtime and transport boundaries avoid real model or storage calls.

## Results

HTTP callback complexity 125 → 113; file debt 105 → 93. Both private helpers stay below 20. Container entrypoint and abort suites passed all 63 tests; Cloudflare package typecheck passed. The initial complexity invocation preceded dependency installation and could not find tsx; after the frozen install, the guard passed.

Candidate review confirmed live smoke admission and runner-slot release remain in the handler, the same request abort signal is passed, and safe diagnostics retain their original guards. Wake acceptance and pending state still finish before the response helper writes the original headers. No infrastructure configuration changed. ReviewGPT and exact-head CI remain external gates after publication.
Completed: 2026-09-14
