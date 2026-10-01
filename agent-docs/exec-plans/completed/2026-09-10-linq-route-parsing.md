# Parse Linq route authority at one contract owner

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and scope

Remove duplicate Linq route parsers across Web, Worker, and runtime. Keep one pure parser in the existing hosted-execution routes contract and remove immediate runtime re-parsing of its normalized result. SMS and iMessage share this boundary.

## Required behavior

Preserve current live Web route authority before planning and provider entry, exact expected-route comparison, health policy, provider claim/idempotency, group isolation, route revocation, voice and reaction delivery. A canonical route binds target and directness together. Missing nullable fields, invalid phone coordinates, mismatched participant recipients, and group routes with a direct recipient fail closed.

## Design

Move existing runtime semantic checks into the common wire contract; replace the weaker Web/Worker copies. Keep each boundary's existing failure handling. The runtime port still validates alternate platform implementations. Require normalized route presence without running the same parser again.

## Tasks and verification

1. Trace all consumers; unify parsing and delete obsolete helpers.
2. Test valid direct/group/participant routes and malformed payloads; replay Web engagement, Worker transport, runtime text/voice/reaction and scheduled authority suites.
3. Typecheck affected owners, review full diff, complexity guard, final scoped commit, draft PR, exact-head CI and ReviewGPT.

## Constraints

No new dependencies, state, configuration, service, route, or authority lookup. No model prompt or permission change; model journey not applicable to this mechanical contract refactor. No production mutation. Existing valid protocol works with old/new Web, Worker, and runtime.

## Verification

- 25 shared route parser cases pass.
- 215 Worker platform tests pass, including malformed/legacy route payloads and health metadata.
- 285 runtime callback tests pass, including text/voice/reaction delivery, current-route checks, provider claims and malformed route fail-closed behavior.
- 67 Web engagement tests pass, including malformed expected routes before DB access and preflight/provider route drift.
- Hosted execution, assistant runtime, Worker, and Web typechecks pass.
- Complexity guard passes: 122 net production source lines deleted; runtime complexity debt falls by five. Existing unrelated effect/transaction hotspots are unchanged.
- Parent diff review: one parser preserves valid protocol and rejects malformed routes earlier; no new effect, latency, persisted state, provider input, or product flow.
- Final candidate ready for exact-head CI and ReviewGPT on its PR; no merge or deploy requested.
Completed: 2026-09-10
