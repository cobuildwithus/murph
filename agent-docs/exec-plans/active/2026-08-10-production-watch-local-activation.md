# Local production-watch activation

Status: active

## Goal

Activate a machine-local, five-minute monitor-only production watcher that collects bounded aggregate evidence from PostgreSQL, Vercel, Cloudflare, and Stripe and maintains a private incident ledger. Automatic diagnosis dispatch and draft-PR remediation remain disabled pending a separately reviewed authority model.

## Scope

- Keep watcher source, pinned scheduler runtime, state, projections, and scheduler files local and ignored in the primary checkout.
- Collect no raw production rows, request bodies, prompts, transcripts, credentials, or direct identifiers.
- Keep provider and sensitive incidents read-only and escalation-only.
- Give the network-disabled edit child no push, GitHub, ReviewGPT, provider, or production authority.
- Reject automatic worker dispatch, repository edits, ReviewGPT invocation, push, and draft-PR creation in the launchable production CLI.
- Derive the scheduler's immutable revision only from the exact clean checkout executing installation; reject conflicting caller assertions.
- Refuse to start the provider child unless the effective MCP set is exactly Cloudflare Observability.
- Never merge, enable auto-merge, deploy, or mutate production/provider state.

## Verification

- Production-watch focused tests and tools TypeScript typecheck.
- Full repository-tools test suite.
- Strict JSON-schema tests, docs drift/gardening, skill validation, diff hygiene, and privacy/secret scans.
- Aggregate-only live preflight for all four production sources.
- ReviewGPT launch gate using the latest published package version.
- Scheduler install followed by a successful launchd collection and status/projection inspection.

## Rollback

Run the watcher scheduler uninstall command. This unloads only its managed launchd job; ignored local source and coordination history remain for inspection.
