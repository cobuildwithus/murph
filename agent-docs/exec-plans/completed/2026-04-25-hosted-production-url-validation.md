# Harden production hosted execution URL validation

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Prevent production Cloudflare hosted execution deploys from pointing at local,
  private-network, preview, or development web/control-plane origins.

## Success criteria

- Production deploy preflight rejects unsafe `HOSTED_WEB_BASE_URL` values:
  `http://`, localhost/loopback, `host.docker.internal`, private-network hosts,
  and preview/development web origins.
- Production deploy preflight enforces explicit deploy-mode alignment: a
  production Worker must point at the production hosted web base URL.
- Local/development Worker env parsing keeps its existing localhost support for
  local hosted execution workflows.
- Focused tests cover the new production deploy URL invariants.

## Scope

- In scope: `apps/cloudflare` hosted execution env/preflight validation and
  directly coupled tests/docs.
- Out of scope: changing runtime local-dev proxy behavior, web deploy config, or
  broad hosted control-plane routing.

## Constraints

- Technical constraints: preserve local `allowHttpLocalhost` behavior for the
  Worker env reader unless production deploy mode is explicitly being checked.
- Product/process constraints: do not print secrets or direct personal
  identifiers in scripts, tests, logs, docs, or handoff.

## Risks and mitigations

1. Risk: Over-tightening URL checks could break local preview workflows.
   Mitigation: scope strict rejection to production deploy mode and keep focused
   test coverage for local/development allowance.

## Tasks

1. Inspect current Cloudflare hosted URL normalization and deploy preflight flow.
2. Add production deploy-mode URL invariant validation.
3. Add focused regression tests for allowed and rejected production modes.
4. Run scoped verification, required audit passes, and direct scenario proof.

## Decisions

- Treat production deploy validation as a deploy-preflight concern so local env
  parsing can continue to accept localhost for development.

## Verification

- Commands to run: focused Cloudflare tests for deploy preflight/env URL
  validation, `pnpm --dir apps/cloudflare verify` if feasible, `pnpm typecheck`,
  `git diff --check`.
- Expected outcomes: all focused checks pass, or any broader failures are
  identified as pre-existing and unrelated to this diff.
Completed: 2026-04-25
