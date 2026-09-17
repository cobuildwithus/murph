# Simplify message admission and runtime launch

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Reduce foreground network and database work before the assistant starts, using existing owners.

## Scope and decisions

- Merge launch preparation and container authorization into one existing owner command at the launch boundary. Keep the old path only for mixed Worker/controller versions, advertised by the existing readiness response.
- Overlap the independent workspace usage read, remove redundant onboarding route preflight, and delete unused crypto entrypoints.
- Preserve runtime fences, durable invocation receipts, onboarding reply recovery, quotas, custom inference, and retained containers. No new state, dependencies, services, or deployment configuration.
- Leave migration retirement to its existing owner.

## Product UX

Existing members, opening replies, duplicate webhooks, concurrent runtime starts, managed/custom inference, and mixed deployments must preserve their outcomes. This changes scheduling and transport, not assistant instructions.

## Tasks

1. Reduce the launch and admission path.
2. Run focused regression tests and relevant typechecks.
3. Review privacy, failure boundaries, and call counts; commit the scoped result.

## Verification

- Web: 146 focused tests passed across instant opening replies and internal runtime routes.
- Cloudflare: 305 tests passed across container readiness, supervised invocation, runtime processing, workspace invocation, and crypto. The final readiness suite passed all 252 cases after updating its capability assertions.
- PostgreSQL: all 32 runtime ownership tests passed on an isolated loopback test database, including concurrent admission, stale fences, consent revocation, and monotonic usage revocation on launch retries.
- Web and Cloudflare typechecks passed. All 10 changelog rendering tests passed after regenerating the ignored fragment module through Web preparation. Existing Frog entry `20260911184822-documented-changelog-test` covers that prerequisite.
- Verification total: 493 passing tests across the nine focused suites. The temporary test database was removed after the ownership suite completed.
- `pnpm complexity:diff --base HEAD` passed for all six changed source files with no increased complexity debt. Existing large functions were reviewed; further changes to their unrelated readiness, delivery, and inference policies are outside this reduction.
- Call-count proof: supported controllers remove the standalone preparation callback; native startup makes one preparation/authorization callback. Older-controller fallback retains its original two calls. One unlocked onboarding route lookup is removed; the route checks under the claim and delivery locks remain.
- Concurrent duplicate launches execute once; evicted receipts and lost completion acknowledgments retain recovery behavior. Custom inference and usage checks remain owned by existing boundaries.
- Changelog: `reply-startup-overhead`; no numeric latency claim. Source PR remains unset until a PR exists.
- Parent review: no new persisted state, dependencies, services, or configuration. The readiness capability is required by documented Cloudflare mixed-version deployment behavior.
- Production latency requires deployment and a fresh message trace; local call-count proof is not measured production speedup. This local task does not publish, merge, or deploy.

Completed: 2026-09-17
