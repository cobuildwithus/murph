# Distinguish rejected route-authority response bodies

## Outcome
Enrich the existing failure-only route-authority diagnostic so missing response bodies can be distinguished from valid JSON with invalid shape. The functional cause remains unresolved. Preserve authorization, parser errors, retries, delivery and all success paths.

## Plan
- [x] Trace transport, parser, Web response and existing diagnostic owners; inspect overlapping work.
- [x] Obtain a minimal ReviewGPT implementation using synthetic evidence.
- [x] Prove new diagnostic assertions fail on original source and pass after the change; run focused typecheck and parent privacy/cost review.
- [ ] Complete scoped commit, draft PR, final ReviewGPT and exact-head CI.
- [ ] Merge and deploy through the canonical workflow; verify serving revision and read-only outcomes.

## Evidence and decisions
Empty/whitespace successful bodies and JSON null currently become the same null payload before route parsing. Existing boolean diagnostics cannot distinguish those paths. Extend the existing observation only; do not assert that a transport fault is proven.

Product UX: Internal diagnostics only; no product behavior or provider-visible input changes. No changelog entry is needed.

## Verification and handoff
ReviewGPT supplied the implementation and its complexity-preserving refinement. The added diagnostic assertions fail on original source (46 failures in the focused matrix) and pass after the implementation. All 330 runner-platform tests pass. Cloudflare typecheck, documentation drift, and the complexity ratchet pass; the existing transport hotspot remains at 40 with no debt increase. Parent review confirmed finite metadata, one response read, unchanged parser errors, no new requests, and failure-only emission.

Implementation is complete. Final pushed-head ReviewGPT, exact-head CI, merge, deployment, and observation remain completion gates tracked by the original automation session. The automation memory owns the private aggregate inventory, deployment/observation times and unresolved production questions. Keep those details out of this plan and review packet.
Status: completed
Updated: 2026-10-21
Completed: 2026-10-21
