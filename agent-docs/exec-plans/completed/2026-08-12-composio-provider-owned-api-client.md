# Adopt Composio's provider-owned API client

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Replace Murph's handwritten Composio request transport and endpoint request
  shapes with Composio's minimal generated TypeScript API client.
- Preserve Murph's stricter member-binding, response-size, diagnostic privacy,
  timeout, and non-retryable write invariants around that provider client.

## Success criteria

- Every request-bearing Composio endpoint uses provider-owned request and
  response types through the official client; the documented bodyless revoke
  endpoint uses the client's typed low-level POST because its generated
  resource is not present in this release.
- Direct execution still requires the authenticated Murph member identity even
  though Composio's generic endpoint type permits accountless custom-auth uses.
- The repository provider-request guard recognizes Composio as an external
  provider boundary.
- Focused tests, Web typecheck, dependency guards/audit, and required PR review
  gates pass.

## Scope

- In scope:
  - The Web-owned Composio client, request-shape tests, dependency manifest and
    lockfile, and provider-request static guard.
  - A narrow typed wrapper for the documented revoke endpoint if the generated
    resource surface does not yet expose that method.
- Out of scope:
  - Changing assistant tools, OAuth ownership, account-selection policy,
    write approval, retry behavior, provider versions, or user-facing copy.

## Constraints

- Technical constraints:
  - Use the zero-transitive-dependency generated REST client rather than the
    larger agent-framework SDK.
  - Disable SDK retries because connected-app writes are not generally safe to
    replay.
  - Keep the existing 30-second request timeout, bounded provider responses,
    and structured-only error diagnostics.
- Product/process constraints:
  - Keep private incident evidence and direct identifiers out of durable
    artifacts.
  - Treat the dependency and provider egress boundary as ReviewGPT-sensitive.

## Risks and mitigations

1. Risk: SDK defaults retry failed requests and can duplicate an irreversible
   connected-app write.
   Mitigation: Set the client retry budget to zero and retain Murph's existing
   ambiguity handling.
2. Risk: Moving parsing into the SDK removes Murph's provider-body memory cap
   or leaks provider text through SDK errors.
   Mitigation: Bound and normalize responses in the injected fetch boundary,
   then translate SDK failures into the existing redacted error type.
3. Risk: The generic direct-execute OpenAPI request makes `user_id` optional
   for valid accountless/custom-auth cases.
   Mitigation: Refine that provider-owned type at Murph's direct-execution
   boundary so `user_id`, arguments, and version are required.

## Tasks

1. [x] Inspect current Composio calls, official packages, generated types, and
   dependency supply-chain metadata.
2. [x] Install the minimal generated client and migrate every supported
   endpoint to its typed resource method.
3. [x] Add Composio to the provider-request guard and strengthen compile/runtime
   boundary coverage.
4. [x] Run focused verification, dependency checks, and inspect the final diff.
5. [x] Push the exact candidate, complete specialist/final review and CI, then
   close the plan with the final scoped commit.

## Decisions

- Use `@composio/client`, Composio's Stainless-generated REST API client, rather
  than `@composio/core`; it covers the current REST surfaces without adding
  agent adapters or transitive runtime dependencies.
- Keep Murph's direct-execute member requirement as a strict refinement of the
  provider type because the generic endpoint also permits accountless custom
  authentication.
- Preserve repeated multi-value connected-account query keys at the injected
  fetch boundary; the generated client defaults to comma serialization, and
  changing that deployed wire shape is outside this hardening change.
- The dependency audit remains red because of existing workspace advisories on
  unrelated dependency paths. The Composio snapshot has no dependencies and
  introduces none of those paths.

## Verification

- Commands to run:
  - Focused connected-app client/service/email tests and provider-boundary
    guard tests.
  - `pnpm --dir apps/web typecheck`.
  - `pnpm deps:guard`, `pnpm deps:audit`, `pnpm deps:ignored-builds`,
    `git diff --check`, and scoped privacy scans.
  - Exact-head CI plus preliminary coverage and final ReviewGPT passes.
- Expected outcomes:
  - Provider-owned endpoint types reject malformed request objects, Murph's
    refinement rejects a direct call without user identity, and runtime request
    bodies remain unchanged.
  - Existing bounded-response, diagnostic-redaction, no-retry, and account
    lifecycle tests remain green.

## Outcomes

- Installed exact `@composio/client@0.1.0-alpha.76`, the current
  Stainless-generated Apache-2.0 REST client. Its package and lockfile snapshot
  have no dependencies or transitive additions.
- Replaced the handwritten Composio transport with generated resource methods
  and provider-owned request/response types. The documented bodyless revoke
  endpoint uses the same client's low-level POST because this release does not
  expose a generated revoke resource.
- Refined `Composio.ToolExecuteParams` so direct Murph writes require
  `arguments`, `user_id`, and `version`, while preserving the provider's
  remaining fields and compile-time drift detection.
- Preserved zero SDK retries, the 30-second timeout, success/error body caps,
  structured-only diagnostics, connected-account ownership filters, and the
  deployed repeated-query-key wire shape.
- Focused proof passed: 54 connected-app Web tests, 21 provider-boundary guard
  tests, Web typecheck, provider/dependency guards, frozen install, ignored
  build checks, docs drift, diff checks, and privacy scan. The full Web,
  package, and built-boundary matrix passed. A host-load-only Cloudflare test
  timeout passed in isolation, and the complete Cloudflare rerun passed all 141
  Node files / 2,401 tests and five Workers files / 10 tests.
- The dependency audit remains red only on existing workspace advisories; an
  explicit audit-path check found no Composio path.
- The preliminary specialist pass accepted one coverage finding: bodyless
  revoke success was modeled as JSON HTTP 200. The inspected test-only patch
  changed that response to bodyless HTTP 204 and asserted exactly three
  list/revoke/delete requests; the corrected 13-test focused suite and broader
  54-test suite pass.
- Final ReviewGPT round 4 returned `ROUND_OUTCOME: PASS` with no findings after
  verifying the accepted correction and the full sensitive provider boundary.
  Required GitHub checks passed on corrected implementation head
  `145eddd00e6eb0d31417aa4fefc127f44d137a09`.
- `git merge-tree --write-tree HEAD origin/main` completed without conflicts
  before plan closure.
Completed: 2026-08-12
