# Privy Error Code Coverage

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

- Preserve Privy's bounded machine-readable error code across the iOS diagnostic
  boundary, cover the SDK's typed `PrivyError` cases, and make the production WAF
  preflight validate the rule shape emitted by the current Vercel CLI.

## Success criteria

- The hosted warning includes an optional strict machine identifier, never raw
  provider prose or authentication data.
- Known `PrivyError` and nested `ApiError` failures map to useful app-owned codes.
- The WAF checker accepts only one enabled, valid, exact-path, fixed-window rule
  limited to 30 requests per minute per IP.
- Focused tests, typechecks, completion audits, iOS tests, and ReviewGPT pass.

## Scope

- In scope: the companion auth diagnostic route, WAF verifier, iOS error mapping,
  focused tests, and matching security/architecture documentation.
- Out of scope: database persistence, raw provider messages, automatic OTP replay,
  SDK verbose logging, App Attest, and enabling the production route.

## Constraints

- Technical constraints: treat pre-login telemetry as spoofable; retain only
  bounded allowlisted fields; keep the route default-off and WAF-gated.
- Product/process constraints: prefer direct typed mappings and deletion of legacy
  WAF parser branches over new logging or authentication infrastructure.

## Risks and mitigations

1. Risk: a caller forges diagnostic events.
   Mitigation: the endpoint has no product-state or database sink and its output is
   operational telemetry only, globally bounded by the required WAF rule.
2. Risk: machine error codes contain provider prose or sensitive context.
   Mitigation: accept lowercase ASCII identifiers only, with a 64-byte maximum.

## Tasks

1. Tighten and test the current Vercel WAF overview contract.
2. Add optional strict provider error-code telemetry to the hosted route.
3. Cover typed Privy SDK failures in the iOS adapter and tests.
4. Run scoped verification, completion audits, and ReviewGPT.

## Decisions

- Do not put a shared secret in the app bundle; it is extractable and replayable.
- Keep raw SDK descriptions local and private; send only typed machine identifiers.
- Do not enable Privy's free-form SDK logger because it broadens the sensitive-log
  surface without improving the thrown-error contract used by this flow.

## Verification

- Commands to run: focused Vitest suites, web typecheck and lint, iOS formatting,
  project generation, simulator tests/build, completion audits, and ReviewGPT.
- Expected outcomes: all checks pass, the production gate remains disabled until a
  matching WAF rule exists, and both repositories contain scoped commits.
Completed: 2026-07-10
