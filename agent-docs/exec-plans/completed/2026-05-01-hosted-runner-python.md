# Add Python to hosted runner image

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make Python available inside the Cloudflare hosted runner container so Codex
  can use it for local scripting when needed, while keeping `vault-cli` as the
  preferred canonical Murph command surface.

## Success criteria

- The stable hosted runner base image installs Python 3 and exposes both
  `python3` and `python` in the runtime `PATH`.
- Runner image/static contract coverage and the final-image Docker E2E smoke
  prove Python availability on the runner `PATH` without moving native tooling
  into the app image layer.
- The assistant system prompt briefly notes Python availability while still
  preferring canonical `vault-cli` commands for Murph work.

## Scope

- In scope:
  - `Dockerfile.cloudflare-hosted-runner-base`
  - Directly coupled Cloudflare runner image/smoke contracts.
  - A local `apps/cloudflare` E2E script alias for the final-image Python
    proof.
  - The assistant system prompt guidance line.
  - Durable deploy docs that list runner base-image tools.
- Out of scope:
  - New Python runtime features or package dependencies.
  - Changes to assistant autonomy, vault command semantics, or hosted auth.
  - Reworking existing hosted runner Codex CLI installation.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not include local usernames, home paths, legal names, secrets, raw
  credentials, or direct personal identifiers in files, logs, or handoff.
- Keep Python as a general-purpose helper only; Murph product actions should
  continue through `vault-cli` and typed runtime surfaces first.
- Keep the Python PATH proof in `runner:docker:smoke`, because that is the
  existing final-image container E2E smoke. Add a named
  `test:e2e:runner-python:local` alias so the proof is easy to run directly.

## Tasks

1. Install Python in the hosted runner base image.
2. Add static and final-image E2E smoke-contract proof that Python is present
   on the runner `PATH`.
3. Add a direct local E2E alias for the Python runner-path proof.
4. Add a brief assistant prompt note about Python availability and the
   `vault-cli` preference.
5. Run focused Cloudflare/assistant-engine verification and diff hygiene.
6. Run required completion audits and close the plan.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/hosted-runner-smoke-contract.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  - `pnpm --dir apps/cloudflare test:e2e:runner-python:local`
  - `pnpm exec vitest run packages/assistant-engine/test/model-behavior.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes:
  - Focused tests passed.
  - Root typecheck passed.
  - Final-image Python E2E passed.
  - No identifier, secret, or local-path leakage appears in the task diff.
Completed: 2026-05-01
