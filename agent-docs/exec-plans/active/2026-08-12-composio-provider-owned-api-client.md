# Adopt Composio's provider-owned API client

Status: active
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
5. [ ] Push the exact candidate, complete specialist/final review and CI, then
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
