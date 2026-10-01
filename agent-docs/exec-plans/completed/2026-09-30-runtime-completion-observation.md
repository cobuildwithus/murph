# Observe canonical runtime completion outcomes

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Distinguish an exact attempt's acknowledged canonical completion from an unconfirmed callback after the owner advances. This is internal operational evidence, not a delivery claim.

## Scope and constraints

Use the existing Cloudflare completion publisher and structured logging pipeline. Add only closed source/outcome fields and established correlation, once per existing call after settlement. Preserve commands, return values, exact thrown errors, call order, warnings, and all product behavior. No state, new I/O, retry, timeout, credentials, private evidence, or new monitoring service.

## Tasks

1. Inspect both completion callers and existing callback/timing logs; establish the historical observation gap.
2. Have ReviewGPT implement focused telemetry and regression tests.
3. Inspect privacy, bounded cost, result/error identity, and source distinctions; prove changed tests fail on the base and pass with telemetry.
4. Update the current Cloudflare owner documentation, run focused proof/typecheck/complexity/docs checks, and open a scoped PR.
5. Complete final ReviewGPT on the pushed head concurrently with required CI. Merge and deploy only telemetry through canonical release if all gates pass; verify live revision and natural observation, or preserve the exact query and blocker.

## Decisions

- Current generation and checkpoint acceptance cannot prove historical canonical completion or provider delivery.
- Existing one-second callback diagnostics stay unchanged. The ordinary outer invocation needs its own observed command acknowledgment using the shared publisher.
- The user authorized telemetry-only merge/deployment after verification; functional changes are outside this PR.

## Risks and mitigations

- Telemetry exceptions must not affect results: isolate logging and assert exact error identity.
- A success log could imply delivery: name canonical acknowledgment only and document the boundary.
- Privacy/cardinality: no payload, error text, target name, generation, or arbitrary status; reuse established attempt correlation and the existing pipeline.
- Mixed revisions: log-only addition with no protocol or data changes.

## Verification

ReviewGPT authored the production observer and focused regression tests; parent inspected the complete patch. The settled-native classification also covers exact native-receipt reconciliation, as documented.

- 359 focused Cloudflare tests passed across completion publication, callback composition, and runner platform behavior. All 32 shared-owner observation cases failed against the unchanged base source, then passed on the candidate.
- Cloudflare typecheck passed. Complexity guard passed, maximum changed function complexity 5 with no hotspots. Documentation gardening passed.
- Synthetic privacy tests and deferred command tests prove closed fields, redacted identity, exact error/result preservation, no early observation, unchanged one-command call count, and logger failure isolation.
- Internal-only telemetry; no member UX, model input, state, schema, protocol, or retry changes. No changelog entry required.
- Parent candidate review passed. Final exact-head ReviewGPT and CI are PR completion gates. Authorized telemetry-only release uses the canonical protected workflow with existing admission/convergence checks; natural read-only evidence must distinguish exact-attempt acknowledgment from delivery.
Completed: 2026-09-30
