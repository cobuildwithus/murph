# Admit Web runtime wakes before Cloudflare dispatch

Status: active
Created: 2026-09-18
Updated: 2026-09-18

## Goal and invariant

Remove the Worker-to-Web admission round trip from Web-originated runtime wakes.
Keep the same Postgres admission transaction, exact member/attempt/generation
checks, container execution proof, and durable Temporal recovery.

## Evidence and architecture

Web currently sends only a member ID to the Worker. The Worker immediately calls
Web to execute the canonical claim transaction and retrieve its owner snapshot.
Web can execute that same transaction locally before dispatch. Pass its existing
response through the existing authenticated ensure-processing request; reuse the
same orchestration, start, wake, and recovery functions. Temporal is a separately
deployed private producer without local Web database access, so its current
callback remains a real requirement, not obsolete compatibility machinery.

## Scope and simplicity

Extend the existing request with an optional admission result. Web supplies it
fresh on every attempt. Only Web OIDC requests may carry it. Bind it to the route
member, validate claimed/existing owner state and processing mode, and retain all
canonical fences for subsequent mutations and native wake/launch operations.
No cache, token format, endpoint, service, configuration, or new state owner.
A completed-owner recovery still claims its successor through canonical Web.
No prompt, tool, or assistant reply policy changes.

## Failure and deployment

Admission failure must prevent dispatch. Unknown transport outcomes must not
release a claimed owner. Stale snapshots must not wake, retire, or replace a
successor; native identity checks and database conditional mutations remain
mandatory. The direct hint remains best effort; Temporal owns durable recovery.

Consumer-first deployment is mandatory: deploy the accepting Worker before Web
emits the new field. Old Web and Temporal requests remain supported. An old
strict Worker rejects the new field before execution and is not a supported
recipient of new Web requests. Roll back Web before rolling the Worker below
this protocol floor. No deployment or production mutation is part of this task.

## Product UX journeys

- Warm message: local admission followed by one Worker request and native wake.
- Cold message: local claim followed by the existing fenced launch path.
- Blocked account: no Worker dispatch after failed admission.
- Concurrent completion/replacement: stale identity cannot operate a successor.
- Retiring runtime: existing exact retirement and retry behavior.
- Temporal recovery and older Web: unchanged claim callback and execution path.

## Tasks

1. Reuse canonical Web admission and extend the existing authenticated request.
2. Verify route authority, parser boundaries, warm/cold dispatch, stale snapshots,
   retries, and blocked admission with synthetic regressions.
3. Run relevant tests, owner typechecks, complexity, and documentation checks.
4. Update durable protocol/deployment documentation, changelog, and parent review.
5. Complete the scoped commit and applicable PR/ReviewGPT workflow.

## Verification

Consumer proof: 448 Worker/native-container tests, 20 orchestration contract
tests, and 89 control-client tests. Package and Cloudflare typechecks pass.
Complexity guard passes with no new debt; unchanged client parser and transport
hotspots remain outside this change. Web focused proof and typecheck are recorded
with the producer commit. Two PRs separate the accepting consumer from the Web
producer; producer merge is held until the consumer is deployed. Production
latency improvement is not yet measured. Final ReviewGPT and CI remain pending.
