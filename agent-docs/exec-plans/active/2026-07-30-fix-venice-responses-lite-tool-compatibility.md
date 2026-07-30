# Fix Venice Responses Lite tool compatibility

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Restore hosted Venice assistant replies when Codex emits its Responses Lite
  `additional_tools` request item, without dropping dynamic tools or weakening
  provider-boundary validation.

## Success criteria

- The Venice egress boundary losslessly restores the supported Codex Responses
  Lite tool advertisement to the standard top-level `tools` field.
- Ordinary Venice Responses requests preserve their existing behavior.
- Ambiguous or malformed tool representations fail closed.
- Focused tests and the Cloudflare TypeScript check pass.
- Required ReviewGPT and exact-head CI gates complete with no unresolved
  actionable findings.

## Scope

- In scope:
  - `apps/cloudflare/src/runner-egress-venice.ts`
  - Focused Venice egress tests
  - Deployment and direct-proof notes required for safe handoff
- Out of scope:
  - Provider selection UX or Web-owned preference storage
  - Codex client changes
  - New provider abstractions or dependencies
  - Production credential use from the local verification lane

## Constraints

- Technical constraints:
  - Preserve the existing request-size ceiling, credential isolation, endpoint
    allowlist, product-model mapping, and Venice safety suffix.
  - Preserve dynamic-tool capability; do not silently remove or reinterpret
    tool definitions.
  - Accept only the exact current Codex Responses Lite envelope and fail closed
    when conversion would require precedence, merge, or deduplication rules.
- Product/process constraints:
  - Keep production evidence redacted and out of repository artifacts.
  - Use the isolated worktree/PR lane and complete required review gates.

## Risks and mitigations

1. Risk: a permissive rewrite could discard metadata or merge conflicting tool
   authorities.
   Mitigation: recognize only one developer-scoped `additional_tools` item with
   the known serialized fields, absent/null top-level tools, and typed tool
   objects; reject all ambiguous shapes.
2. Risk: a unit-only transformation could still differ from live Venice
   behavior.
   Mitigation: verify against the official Venice OpenAPI contract, retain a
   post-deploy controlled inference smoke, and do not use production
   credentials locally.
3. Risk: Worker/container skew could leave old egress behavior warm.
   Mitigation: document immediate Cloudflare rollout and verify the deployed
   Worker/bundle fingerprint plus a controlled Venice reply.

## Tasks

1. [x] Validate the Codex and Venice request contracts.
2. [x] Apply and independently review the scoped ReviewGPT patch.
3. [x] Run focused tests and TypeScript verification.
4. [ ] Commit, push, open a PR, and run the required preliminary and final
   ReviewGPT gates concurrently with exact-head CI.
5. [ ] Resolve actionable findings, close the plan, and provide deployment
   proof.

## Decisions

- Own the correction at the final Venice request-body compatibility boundary;
  Web and Codex remain unchanged.
- Preserve the embedded tool array byte-for-structure by relocating it rather
  than translating individual tool definitions.
- Reject future/unknown `additional_tools` variants until their semantics are
  explicit.

## Verification

- Commands to run:
  - Focused Venice egress Vitest target
  - Cloudflare TypeScript check covering the changed source and test
  - Exact-head GitHub Actions required checks
- Expected outcomes:
  - Ordinary and Responses Lite requests normalize as specified.
  - Malformed or conflicting representations return the existing fail-closed
    sentinel.
  - No unrelated files change and all required checks are green.
- Completed local outcomes:
  - Focused Venice egress tests: 5 passed.
  - Adjacent egress intercept tests: 213 passed.
  - Cloudflare TypeScript check: passed.
