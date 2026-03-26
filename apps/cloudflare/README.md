# @healthybob/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Healthy Bob SaaS path.

This app is intentionally separate from `apps/web`:

- `apps/web` stays the public onboarding, billing, OAuth, and webhook control plane.
- `apps/cloudflare` handles signed internal dispatch, per-user coordination, encrypted hosted bundle storage, and one-shot execution against the existing Healthy Bob inbox and assistant runtime seams.

## Core responsibilities

- verify signed internal dispatch from `apps/web`
- coordinate per-user runs through a Durable Object
- store encrypted hosted bundle snapshots in object storage
- restore a temporary vault plus sibling assistant-state for one-shot execution
- run existing Healthy Bob inbox + assistant logic for activation, direct Linq messages, and periodic assistant ticks

## Non-goals

- public browser routes
- canonical hosted health-data storage outside the vault bundle
- a second inbox or assistant runtime model
- operator-blind privacy or TEE claims

## Required bindings and environment variables

Worker bindings:

- `USER_RUNNER` Durable Object namespace
- `BUNDLES` object-storage bucket

Required secrets/config:

- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`

Optional but expected in real deployments:

- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID`
- `HOSTED_EXECUTION_CONTROL_TOKEN`
- `HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS`
- `HOSTED_EXECUTION_RUNNER_BASE_URL`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`

## Routes

- `POST /internal/dispatch`
- `GET /internal/users/:userId/status`
- `POST /internal/users/:userId/run`

## Typecheck note

The app-local no-emit typecheck excludes the Node runner bridge files that import the current `@healthybob/cli` runtime directly. Those files are still exercised by the app Vitest suite; the exclusion keeps this app's typecheck scoped to its own source while unrelated in-flight CLI typing issues remain elsewhere in the workspace.
