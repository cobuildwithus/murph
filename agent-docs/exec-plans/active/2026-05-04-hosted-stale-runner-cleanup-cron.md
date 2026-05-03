# Hosted Stale Runner Cleanup Cron

## Goal

Add a production cron path that can clean up explicitly listed stale hosted runner Durable Objects through the existing Cloudflare hosted-control deletion client.

## Constraints

- Do not commit raw stale hosted member ids.
- Cron must require the existing Vercel cron bearer authorization.
- Cleanup must skip any candidate id that still exists in `HostedMember`.
- Cloudflare cleanup must use the existing hosted runner deletion client, not a new broad Cloudflare admin surface.
- Preserve unrelated dirty work in `apps/web` and the coordination ledger.

## Plan

1. Add a small hosted-runner stale cleanup library that reads candidate ids from environment configuration.
2. Validate candidates, dedupe them, check `HostedMember`, and delete only missing members through `deleteHostedRunnerUserDataBestEffort`.
3. Add a Vercel cron route and schedule.
4. Add focused tests for parsing, DB safety skip, and delete invocation.
5. Run scoped verification and required reviews, then commit only this task's files.

## Verification

- Pending.
