# Classify hosted workspace read failures

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Classify hosted workspace-read HTTP failures with privacy-safe telemetry while
  preserving the existing request, exception, retry, and user-visible behavior.

## Success criteria

- A bounded background probe records only status, allowlisted code,
  retryability, forwarded-response state, and a fixed envelope outcome.
- Unknown, malformed, missing, oversized, or unreadable bodies never expose raw
  code, messages, payloads, or identifiers.
- Focused tests prove the exact legacy error and fetch count remain unchanged.
- Cloudflare focused tests, typecheck, privacy checks, review gates, and CI pass.

## Scope

- In scope: the HostedUserRunner workspace-read failure boundary, its test
  controls and focused tests, plus the owning runtime protocol documentation.
- Out of scope: functional retries, Web route behavior, provider interaction,
  device sync, new persistence, and production traffic generation.

## Constraints

- Technical constraints: reuse Durable Object `waitUntil`, the existing bounded
  response-body reader, and the existing structured logger; cap bytes and time.
- Product/process constraints: one telemetry-only PR; no autonomous deployment
  unless every repository and automation gate passes on the exact head.

## Risks and mitigations

1. Risk: telemetry body inspection delays or changes the caller failure.
   Mitigation: clone the response and run the bounded probe under `waitUntil`
   before throwing the same plain `Error` immediately.
2. Risk: private Web error detail reaches logs.
   Mitigation: parse only an envelope shape, map codes through a closed allowlist,
   ignore messages/details, and test private sentinels.
3. Risk: an unbounded stream consumes Worker resources.
   Mitigation: enforce a small byte ceiling and existing abort-aware read timeout.

## Tasks

1. Done: implement the bounded failure classifier and background structured log.
2. Done: add direct regression tests for classified, unknown, malformed, and oversized
   responses plus unchanged exception/control-flow behavior.
3. Done: update the runtime protocol, run focused proof, and inspect the full patch.
4. In progress: commit, push, open the PR, and complete exact-head CI gates.

## Decisions

- The current code discards the Web JSON error envelope and retains only HTTP
  status, so existing evidence cannot distinguish request-contract, callback
  authorization/replay, or another handled validation failure.
- Active rollout, OpenAI paging, and Browser Vault work do not own this narrow
  response-classification boundary.
- The user explicitly replaced ReviewGPT implementation/review with local
  authorship and parent review for this continuation.

## Verification

- Passed: 363 focused Cloudflare tests covering HostedUserRunner and the shared
  Web-control transport; Cloudflare typecheck; docs drift; log privacy guard;
  source-sidecar guard; and diff whitespace checks.
- Passed: canonical `pnpm --dir apps/cloudflare verify` with 151 Node test files
  (2,726 tests passed, two skipped) and five Workers-runtime files (14 passed).
- Parent review confirmed the diff is telemetry/tests/docs only, reuses the
  existing body reader/logger/lifecycle owner, and changes no request, retry,
  persisted state, provider call, or user-visible behavior.
Completed: 2026-08-30
