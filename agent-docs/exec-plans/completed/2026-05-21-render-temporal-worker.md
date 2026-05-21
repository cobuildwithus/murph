# Render Temporal Worker Setup

## Goal

Add a minimal Render deployment path for the hosted Temporal worker, including
production startup, Temporal Cloud credential wiring, local Temporal CLI setup
guidance, and focused verification.

## Scope

- Root Render Blueprint for the Temporal background worker.
- Hosted Temporal worker env parsing and connection option construction.
- Hosted web Temporal signal client API-key/TLS env parsing and connection
  option construction.
- Hosted web `.env.example` documentation for the Temporal signal client.
- Temporal worker package scripts/tests/docs.
- Root helper script/package script for installing or checking the Temporal CLI.

## Constraints

- Do not store real secrets or account-specific identifiers in repo files.
- Keep Temporal workflow state pointer-only; this task does not change workflow
  behavior.
- Preserve unrelated active Cloudflare/runtime and research working-tree edits.
- Render runs the worker as a continuously running background worker; Render
  Workflows are not part of this setup.
- Web deployment secrets use `HOSTED_TEMPORAL_*` names by preference and may
  fall back to unprefixed `TEMPORAL_*` names for local compatibility.

## Verification

- `bash -n scripts/setup-temporal-cli.sh`
- Focused hosted-web Temporal signal client tests.
- `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
- `pnpm typecheck`
- Render Blueprint validation if the Render CLI is available locally.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
