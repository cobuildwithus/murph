# Hosted-local Temporal E2E lifecycle

Status: active
Created: 2026-05-20
Updated: 2026-05-20

## Goal

Make the canonical hosted-local E2E stack manage a local Temporal server and
Temporal worker so at least one default hosted-local E2E scenario proves the
production-shaped path:

`apps/web` signal -> Temporal `signalWithStart` -> Temporal worker workflow ->
web demand activity -> Cloudflare ensure-execution activity -> runner execution.

## Success criteria

- `pnpm hosted-local e2e temporal-orchestration --profile e2e:stub` fails when
  the Temporal CLI is missing, Temporal env is not injected, the worker is not
  polling, or the workflow does not reach Cloudflare ensure-execution.
- `pnpm test:e2e:hosted-local` includes a non-manual Temporal orchestration
  scenario.
- Hosted-local `e2e:stub` and `e2e:live` default to managed Temporal; `dev`
  remains explicit and `worker-only` stays disabled unless overridden.
- Lifecycle, readiness, shutdown, and diagnostic behavior stay inside the
  existing hosted-local stack.

## Scope

- In scope: hosted-local config/profile/env parsing, Temporal local lifecycle
  helper, stack process wiring, focused E2E scenario registration/tests, and
  durable docs/verification map updates.
- Out of scope: production Temporal Cloud deployment changes, broad web Temporal
  client unification, Cloudflare scheduling semantics, or assistant runtime
  behavior changes outside what the E2E proof requires.

## Constraints

- Technical constraints: preserve existing dirty hosted Temporal/Cloudflare
  work; keep Temporal state pointer-only; do not introduce a second local stack
  manager; no new third-party dependencies.
- Product/process constraints: do not expose local identifiers, secrets, raw
  mailbox payloads, provider payloads, prompts, transcripts, or local paths in
  code, docs, logs, or test failure output.

## Risks and mitigations

1. Risk: starting Temporal before web/Cloudflare are reachable can create
   activity failures during readiness.
   Mitigation: inject Temporal env before web starts, but start the Temporal
   server and worker after web/worker base URLs are known; readiness waits for a
   Temporal smoke query before reporting healthy.
2. Risk: E2E mode could silently fall back to direct Cloudflare routes.
   Mitigation: add a scenario that signals through the web Temporal client and
   queries the workflow before checking runner status.
3. Risk: shutdown leaks a Temporal worker or dev server.
   Mitigation: add both processes to the existing child list and terminate them
   through the same stop path.

## Tasks

1. Add hosted-local Temporal config and profile defaults.
2. Implement the Temporal lifecycle helper and readiness probe.
3. Wire managed/external Temporal into `startHostedLocalDevStack`.
4. Add a focused Temporal orchestration hosted-local E2E scenario.
5. Update hosted-local scenario registration, docs, and tests.
6. Run focused checks, required audits, and scoped commit flow.

## Decisions

- Use `MURPH_DEV_TEMPORAL=managed|external|disabled` as the local stack mode.
- Keep local E2E on managed Temporal by default; keep interactive `dev` explicit
  to avoid surprising developers who do not have the Temporal CLI installed.
- Use the existing Temporal CLI dev server and worker package instead of
  Docker Compose or a bespoke sidecar stack.

## Verification

- Commands to run: focused hosted-local harness tests, Temporal package tests as
  needed, scenario registration tests, `pnpm typecheck`, and the targeted E2E
  command when local dependencies are available.
- Expected outcomes: static checks pass; targeted E2E proves Temporal server,
  worker task queue polling, web demand, and Cloudflare ensure-execution.
