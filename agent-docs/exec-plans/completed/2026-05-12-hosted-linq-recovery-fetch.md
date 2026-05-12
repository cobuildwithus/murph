# Hosted Linq recovery fetch wrapper

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Hosted Linq missing-thread recovery probes use the same hosted provider fetch wrapper as normal Linq sends, so Cloudflare write-fence headers remain attached during recovery.

## Success criteria

- `resolveHostedProviderLinqRecoverySenders` passes the adapted hosted provider fetch into `probeLinqApi`.
- A focused assistant-runtime test proves recovery probing uses the dependency-provided fetch implementation instead of raw global fetch.
- Required focused verification, typecheck, and completion audits pass or any unrelated blocker is documented.

## Scope

- In scope: hosted Linq provider-effect recovery sender probing and focused tests.
- Out of scope: Cloudflare intercept implementation, Linq API parsing behavior, hosted web ingress, and provider credential policy changes.

## Constraints

- Technical constraints: keep normal sends and recovery probes on one fetch-adapter path; do not add a second auth or retry mechanism.
- Product/process constraints: preserve unrelated dirty work and avoid exposing local identifiers, secrets, or authorization headers in artifacts.

## Risks and mitigations

1. Risk: recovery silently falls back to raw global fetch and loses runtime write-fence headers.
   Mitigation: pass `adaptHostedProviderFetchForLinq(input.dependencies.fetchImplementation)` to the recovery probe and test that global fetch is not used.
2. Risk: changing recovery sender selection affects direct materialization behavior.
   Mitigation: keep the returned phone-number normalization unchanged and verify the recovered direct send still succeeds.

## Tasks

1. Thread the hosted provider fetch adapter into the Linq recovery probe.
2. Add a focused regression test for dependency fetch usage during recovery probing.
3. Run required verification and completion audits.
4. Close the active plan through the scoped finish path if the worktree permits it.

## Decisions

- Reuse the existing `adaptHostedProviderFetchForLinq` helper so normal Linq sends and recovery probes share the same fetch boundary.

## Verification

- Commands to run: assistant-runtime focused test, `pnpm typecheck`, diff-aware verification if truthful, and required completion audits.
- Expected outcomes: the recovery probe uses the dependency fetch wrapper, does not call raw global fetch, and still materializes the direct Linq thread.
Completed: 2026-05-12
