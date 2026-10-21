# Remove a sequential runner wake round trip

Status: active
Created: 2026-10-21
Updated: 2026-10-21

## Goal

Reduce fresh-start latency without changing canonical target selection, immutable
member binding, readiness, or launch authorization.

## Evidence and limits

Historical native traces distinguish caller RPC duration from controller work.
Binding has a substantial pre-handler platform delay; SQL and application work
inside binding do not explain it. Standby process warmth does not prove controller
residency. Neither local startup profiling nor deployment startup metadata proves
the cause of the platform interval. No production timing improvement is claimed.
The source independently proves that binding and readiness currently require two
sequential RPCs to the same target.

## Success criteria

- Fresh allocation can bind and prove readiness in one RPC.
- Older controllers and retained targets keep their existing readiness path.
- Failed binding cannot prepare or launch another member's container.
- Busy/ambiguous readiness preserves the selected target for reconciliation.
- Focused tests, Cloudflare typecheck, complexity review, and scoped commit pass.

## Scope and constraints

Only the optional bind/readiness composition and its caller, tests, and owner
documentation change. No production mutation, new telemetry, pool policy, auth
shortcut, retry-owner change, or asserted fix for opaque platform latency.

## Risks and mitigations

- Rolling versions: optional request and response fields retain legacy fallback.
- Lock recursion: release binding's lifecycle lock before ordinary readiness.
- Lost acknowledgment: existing canonical selection and exact retry path remain.
- Longer RPC: bound the combined operation with the ordinary readiness budget.

## Product UX

Outcome: fewer sequential steps before a fresh conversation starts.
Reaches: fresh foreground and background allocation; retained owners unchanged.
Proof: fresh/legacy, wrong-member binding, busy readiness, and uncertain RPC tests.
Status: Ready for local behavior. Hold for production latency and external review.

## Tasks

1. Compose readiness at the existing native binding owner.
2. Consume readiness in fresh orchestration, retaining compatibility fallback.
3. Verify authority, recovery, rolling versions, and typecheck; review the diff.
4. Record completion evidence and commit the scoped change.

## Verification

- Passed focused orchestration, standby lifecycle, target identity, and native
  supervised-invocation tests. Added real-owner warm health and queued-bind
  deadline proof, legacy compatibility, and uncertain/busy recovery cases.
- Passed `pnpm --dir apps/cloudflare typecheck`.
- Passed `pnpm complexity:diff`; existing hotspots are unchanged.
- Passed changelog generation and all 10 archive rendering tests. The narrow
  entry makes no measured timing promise; add its PR provenance when opened.
- Parent reviewed the full diff, privacy, rolling versions, lifecycle locks,
  elapsed readiness budget, binding identity, launch authority, and uncertainty.
- No new telemetry, production writes, or deployment.

## Remaining work

The combined RPC removes a round trip; it does not prove or eliminate the
platform interval before the first receiver invocation. Cloudflare-internal
routing/activation evidence is needed to attribute that interval more narrowly;
application traces and deployment startup metadata cannot do so. Do not report
this local optimization as a fix for the entire observed bind delay.

A pushed PR, final ReviewGPT, exact-head CI, deployment, and production before/after
measurement have not run. The task currently authorizes the local fix and scoped
commit; the routing owner distinguishes that from a PR/publish request. Keep this
plan active while the root-cause investigation remains unresolved.
