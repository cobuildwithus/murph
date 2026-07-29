# PlanetScale metrics service-token auth hotfix

Status: completed

## Goal

Restore the deployed database-health monitor's PlanetScale service discovery so
scheduled checks persist successful Prometheus samples and can alert on real
database conditions.

## Production evidence

- The production Worker, cron trigger, and Durable Object RPC all run
  successfully.
- Four consecutive scheduled checks persisted
  `service_discovery_failed`.
- PlanetScale's service-token contract requires
  `Authorization: <SERVICE_TOKEN_ID>:<SERVICE_TOKEN>` with no authentication
  scheme, while the deployed request prepends `token `.

## Scope

- Correct the PlanetScale discovery authorization header.
- Update the focused monitor test to lock the provider contract.
- Run scoped Cloudflare tests, typecheck, canonical diff verification, the
  preliminary completion-specialists review, CI, and the final PR ReviewGPT
  gate.
- Redeploy through the protected production workflow and observe a natural
  successful scheduled sample.

## Invariants

- Never place the service token in URLs, logs, fixtures, or durable artifacts.
- Keep the signed scrape URL unauthenticated beyond its signed query
  parameters.
- Preserve persistent 30-day metric history, fail-closed Linq health checks,
  and the global one-attempt-per-30-minutes Linq fence.
- Do not induce a database failure or send a synthetic production alert.

## Preliminary product review

- The hotfix is the smallest correction that restores discovery without
  changing alert copy, pacing, Linq health checks, or the signed metrics scrape.
- Corrected the durable security contract so it documents the provider's
  scheme-less service-token header.
- Production acceptance requires a natural scheduled check with no collection
  failure, proving the successful sample path and consecutive-failure reset.

## Review evidence

- The preliminary completion-specialists pass returned `PASS` with no findings
  and no patch artifact. The configured Pro model completed in 298 seconds;
  manual specialist attestation is accepted under the documented four-minute
  floor because the exact PR head, attachment, turn, model selection, completion
  marker, and substantive coverage analysis were all captured.
- Parent final review found no remaining gap: the credential reaches only the
  fixed discovery origin, the signed scrape remains credential-free, and the
  existing successful-sample transaction resets the failure counter before it
  persists the sample.
- Canonical diff verification passed the exact unchanged candidate after the
  preliminary pass requested no remediation.
Updated: 2026-07-29
Completed: 2026-07-29
