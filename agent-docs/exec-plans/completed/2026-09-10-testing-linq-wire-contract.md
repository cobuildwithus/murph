# Verify Linq wire contracts in hosted-local tests

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make hosted-local messaging proof reject invalid Linq requests and detect lost
provider idempotency instead of manufacturing successful delivery.

## Owner, evidence, and scope

- The shared HTTP Linq stub owns synthetic provider behavior. Production SDK
  clients, hosted credential injection, and delivery owners remain canonical.
- The stub accepts missing credentials, validates any one message part, emits
  two identity envelopes, and replays lost acknowledgements by body without a key.
- Correct that boundary and affected harness wiring/assertions. Preserve
  deterministic pre-accept and post-accept failures. Add no production state.
- Canary workflows and live provider journeys belong to separate work.

## Protected invariants and decisions

- Hosted runners send their sentinel to the trusted egress owner; only that
  owner injects a synthetic upstream token. Never give the runner provider secrets.
- A missing idempotency key is valid vendor input but cannot prove exactly-once
  retries. Negative proof must observe duplicate acceptance, not invent a 400.
- Use published Linq v3 documentation and the pinned generated SDK as independent
  evidence. Keep one vendor-shaped response identity.
- Test state stays process-local; failed requests cannot consume unaccepted keys.
- Internal proof infrastructure only: no product UX, changelog, or deploy change
  unless credential tracing proves a runtime defect.

## Tasks

1. Confirm vendor contracts and trace synthetic credential egress.
2. Add failing wire-level mutation proof and real-client HTTP integration.
3. Correct the shared server and affected scenario expectations/wiring.
4. Run focused tests, typecheck, complexity review, and parent candidate review.
5. Close the plan, wrapper-commit, push, and open a complete draft PR. The original
   parent owns Ready, final ReviewGPT, and exact-head CI completion.

## Verification

- Cloudflare Node Vitest: shared Linq support, wire-contract integration, and
  relevant provider egress/harness tests.
- Cloudflare typecheck with documented generated-input preparation if needed.
- Focused hosted-local journey when the isolated stack permits it.
- pnpm complexity:diff; git diff --check; privacy and candidate diff inspection.

## Progress

- Read routing, architecture/invariants, security, reliability, messaging,
  verification, completion, and worktree guidance.
- Frozen dependency installation succeeded; Frog list reviewed.
- Official v3 SDK confirms optional nested message.idempotency_key, exclusive
  media references, isolated links, and the chat_id/message response envelope.

- The production card-client conformance test now reaches the shared HTTP server
  through generated runner env, provider-fetch, and Worker interception. The
  authority RPC remains an explicit test boundary; no canned Linq response remains.
- Confirmed in official Cloudflare documentation that outbound interception only
  handles ports 80/443. Local random-port Linq calls previously bypassed it and
  reached the permissive stub with the runner sentinel. Container env now uses
  canonical HTTPS; the existing Worker handler owns custom upstream redirection.
- Six affected E2E files now require the synthetic upstream token, and the
  foreground-ordering scenario declares its custom synthetic token explicitly.
- Focused proof: 356 tests across wire contracts, helper, env policy, provider
  conformance, runner env, and runner interception; Cloudflare typecheck passed.
- Complexity guard passed: source debt 0 to 0, maximum complexity 5 to 5, no
  changed source functions above 20. Deleted body-based replay and permissive
  credential classification rather than adding another retry or auth owner.
- Full journey command `pnpm hosted-local e2e provider-egress-token-bridge`
  stopped before stack startup: runner boot closure 2,055,246 bytes exceeds the
  existing 2,046,662-byte cap. Rebuilding the unchanged production source at base
  `ede77ecb7929cef8a930b64d5d387909f62ae922` and running
  `pnpm exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts --skip-build`
  reproduced the same budget-guard failure. Candidate source was restored and
  rebuilt. Existing Frog issue #2375 covers this friction; no duplicate entry.
- Remaining proof: real container interception after the independent bundle
  blocker is resolved, then parent-owned exact-head CI and final ReviewGPT.
- Parent reviewed the stable candidate and found no blocker. Scoped commit and
  draft PR are authorized; parent retains Ready and final-review ownership.
Completed: 2026-09-10
