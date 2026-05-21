# Temporal dev and CI hardening

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

Make local hosted development and CI prove hosted Temporal orchestration without
requiring developers or CI jobs to remember separate manual Temporal setup.

## Success criteria

- `pnpm dev` starts managed local Temporal server and Temporal worker by default.
- Hosted-local E2E CI has a dedicated `temporal-orchestration` job that installs
  or verifies the Temporal CLI before running the scenario.
- `pnpm temporal:cli:setup` is pinned and can install Temporal CLI on CI Linux
  without relying on Homebrew.
- Root README documents the Temporal CLI prerequisite for hosted-local E2E and
  local dev.
- Web and worker Temporal env behavior has a focused drift guard or shared
  contract coverage.

## Scope

- In scope: hosted-local profile defaults, Temporal CLI setup/check scripts,
  Cloudflare hosted E2E workflow, root README, Temporal env drift tests/docs.
- Out of scope: production Temporal Cloud deployment changes, another local
  stack manager, schema/storage changes, broad web/client refactors.

## Constraints

- Preserve unrelated active work and ledger rows.
- Do not expose local paths, local account names, secrets, raw identifiers,
  provider payloads, prompts, transcripts, or full authorization headers.
- Keep managed Temporal lifecycle inside the existing hosted-local stack.

## Risks and mitigations

1. Risk: `pnpm dev` becomes surprising or unusable when the Temporal CLI is
   missing.
   Mitigation: keep the failure message actionable through the existing managed
   Temporal CLI assertion and document `pnpm temporal:cli:setup`.
2. Risk: CI installs an unpinned binary or drifts from local setup.
   Mitigation: pin `TEMPORAL_CLI_VERSION` in the setup script and reuse the same
   script in CI.
3. Risk: web and worker Temporal connection env parsers drift.
   Mitigation: add a small matrix test that compares common env behavior.

## Tasks

1. Inspect existing hosted-local, Temporal CLI, CI, README, and env parser code.
2. Change dev defaults to managed Temporal.
3. Make Temporal CLI setup pinned and Linux-friendly.
4. Add dedicated Temporal orchestration CI job and path triggers.
5. Add README and env drift coverage.
6. Run focused verification, required reviews, and scoped commit.

## Decisions

- Use the current hosted-local stack Temporal helper; do not add Compose or a
  second local stack.
- Treat the user's explicit request as overriding the earlier review suggestion
  that interactive `pnpm dev` stay disabled by default.
- Prefer `HOSTED_TEMPORAL_*` env names over plain `TEMPORAL_*` names in the
  Temporal worker parser too, while preserving the worker's local default
  address.

## Progress

- Done: dev profile/config default managed Temporal; worker-only and
  `MURPH_DEV_SKIP_WEB=1` still default disabled.
- Done: Temporal CLI setup now installs a pinned official release on Linux or
  Darwin with checksum verification when no CLI is already on `PATH`.
- Done: Cloudflare hosted E2E workflow now has a focused
  `temporal-orchestration` job and Temporal-specific path filters.
- Done: README/package/durable docs describe the new default and CI coverage.
- Done: worker Temporal env tests cover hosted-prefixed alias precedence and TLS
  material.
- Done: focused syntax/unit checks, full `pnpm typecheck`, and scoped
  `test:diff` verification passed; `pnpm typecheck` was rerun after the final
  Temporal CLI error-message edit.
- Next: run completion audits and finish the scoped commit.

## Verification

- Passed: `bash -n scripts/setup-temporal-cli.sh`.
- Passed: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/cloudflare-hosted-e2e.yml")'`.
- Passed: the workflow YAML syntax check again after adding the hosted-web
  orchestration test path trigger.
- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/config.test.ts --no-coverage`.
- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/temporal.test.ts scripts/dev-hosted-local/config.test.ts --no-coverage`.
- Passed: `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts test/temporal-env.test.ts --no-coverage`.
- Passed: `TEMPORAL_CLI_INSTALL_DIR=.tmp/temporal-cli-test-bin PATH=/usr/bin:/bin bash scripts/setup-temporal-cli.sh`.
- Passed: `pnpm typecheck` before and after the final Temporal CLI error-message edit.
- Passed: scoped `bash scripts/workspace-verify.sh test:diff ...` for this task's files.
- Passed: `git diff --check` for this task's files.

## Completion review

- Security/privacy: new installer verifies release checksums, avoids printing
  expanded repo/home paths, and the added diff lines contain no local account
  identifiers, secrets, auth headers, or raw credentials.
- Coverage: config tests prove managed dev default, worker-only/skip-web
  disabled default, and external-address fallback; Temporal env tests prove
  hosted-prefixed precedence, hosted mTLS material, and hosted TLS validation.
  CI YAML syntax and the scoped diff lane cover the workflow wiring.
Completed: 2026-05-21
