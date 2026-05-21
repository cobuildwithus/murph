# Render Temporal Worker Setup

## Goal

Add a minimal Render deployment path for the hosted Temporal worker, including
production startup, Temporal Cloud credential wiring, local Temporal CLI setup
guidance, and focused verification.

## Scope

- Root Render Blueprint for the Temporal background worker.
- Hosted Temporal worker env parsing and connection option construction.
- Temporal worker package scripts/tests/docs.
- Root helper script/package script for installing or checking the Temporal CLI.

## Constraints

- Do not store real secrets or account-specific identifiers in repo files.
- Keep Temporal workflow state pointer-only; this task does not change workflow
  behavior.
- Preserve unrelated active Cloudflare/runtime and research working-tree edits.
- Render runs the worker as a continuously running background worker; Render
  Workflows are not part of this setup.

## Verification

- `bash -n scripts/setup-temporal-cli.sh`
- `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
- `pnpm typecheck`
- Render Blueprint validation if the Render CLI is available locally.
