# Bounded hosted fetch network diagnostics

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Distinguish nested network failure codes on existing hosted fetch failure logs without changing transport, retry, authority, or product behavior.

## Evidence and ownership

A read-only investigation found recurring artifact upload failures before an HTTP response, with generic TypeError classification and no caller cancellation or timeout signal. The deployed R2 service-code recovery covers a different boundary. The underlying network cause remains unproven. Open progress diagnostics do not cover this signal.

The current control-plane fetch error owner retains only the direct cause classification. Two synthetic cases with nested ECONNRESET and UND_ERR_SOCKET fail because buildHostedRuntimeSafeErrorMetadata omits that distinction. Existing classifications pass.

## Scope and constraints

ReviewGPT authors production implementation and substantive revisions. Extend only existing control-plane fetch diagnostics and their safe metadata projection, focused tests, and the affected owner contract. Preserve typed errors, cancellation, retry policy, write fences, timeouts and success paths. No new event, network request, state, dependency, queue, scheduler, arbitrary error text, address, port, URL, stack or payload.

Use a finite allowlist and bounded cause traversal. Omit unknown or unsafe values. Retain existing observability retention and sampling; one optional small field per existing failure event adds bounded storage cost and no event volume.

## Tasks

1. Reproduce the missing signal with synthetic tests (done: two expected failures).
2. Obtain and inspect exact ReviewGPT implementation (done; applied the captured unified diff exactly).
3. Run focused boundary and transport regressions, affected typecheck, privacy/docs and complexity checks; inspect complete diff (done: 279 tests pass, typecheck and all guards pass; no complexity hotspots above 20).
4. Close this implementation plan and publish the tested candidate. Final ReviewGPT and exact-head CI are tracked on the PR by the original task owner.
5. Merge/deploy only under established telemetry authority after required gates and exact release-scope proof. Record any blocker honestly.

## Observation and retention

Question: do natural failed fetches carry a known nested socket, DNS, connection or transport timeout code? After a verified rollout, query existing failure events over 24 hours grouped by operation, existing failure kind, and the optional network code. Treat missing codes as unavailable evidence and layered events as logs, not distinct incidents. Do not trigger failures or replay. Retain this finite field if it distinguishes causes under existing retention; reassess or remove if natural failures show no diagnostic value. No separate observer or ledger.

## Verification

- Before patch: focused control-plane-fetch-diagnostics tests fail 2/2 only for absent fetchNetworkErrorCode.
- Candidate: all 279 tests in focused diagnostics, response-body, runner-platform and runtime transport suites pass. Cloudflare typecheck passes after ordinary Prisma generation. Logging/privacy, docs drift, complexity and whitespace guards pass. Complexity maximums are 17 and 16 for the two changed source files; no hotspots above 20.
- Native local socket reproduction: a synthetic server closed after request data; Node fetch threw TypeError with nested UND_ERR_SOCKET. This demonstrates the error shape, not the production cause.
- Parent review: production changes are additive diagnostic projection only. Nine finite codes, at most four cause objects, no new data/event/network/state owner. Tests preserve old wrapper behavior, privacy and exact composed request/event counts.
- ReviewGPT returned a validated gpt-6-pro response; the exact captured inline patch applied without changes after the artifact downloader hit known issue #2588. The exact authoring documentation correction removes the incorrect packet-supplied fourteen-day Workers retention claim; current official Workers Logs maximum is seven days, and no configuration is changed. The short correction initially lacked capture-time model metadata; the supported thread export subsequently proved the exact committed turn, completed response, gpt-6-pro metadata and identical correction patch.
- PR exact-head CI and final ReviewGPT remain separate completion gates; telemetry merge/deployment remains conditional on gates and release-scope authority.
- Product UX and real-Codex journeys: internal metadata only; no prompt, tool, reply, UI, or member-visible behavior changes.
- Frog: existing issue #2662 covers the supplied-worktree guard failure; sanctioned helper from primary created this isolated checkout. No new entry.
Completed: 2026-09-06
