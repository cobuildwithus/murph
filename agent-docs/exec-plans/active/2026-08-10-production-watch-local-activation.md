# Local production-watch activation

Status: active

## Goal

Activate a machine-local, five-minute monitor-only production watcher that collects bounded aggregate evidence from PostgreSQL, Vercel, Cloudflare, and Stripe and maintains a private incident ledger. Automatic diagnosis dispatch and draft-PR remediation are not implemented; any future automation requires a separate design and review.

## Scope

- Keep watcher source tracked in the repository while the pinned scheduler runtime, state, projections, and scheduler files remain machine-local and ignored.
- Collect no raw production rows, request bodies, prompts, transcripts, credentials, or direct identifiers.
- Keep provider and sensitive incidents read-only and escalation-only.
- Exclude automatic worker dispatch, repository edits, ReviewGPT invocation, push, and draft-PR creation from the launchable production CLI.
- Derive the scheduler's immutable revision only from the exact clean checkout executing installation; reject conflicting caller assertions.
- Ignore mutable Codex user config and refuse to start the provider child unless the reviewed model/effort/disabled-feature contract and effective MCP set of exactly Cloudflare Observability are re-established.
- Pin the installer-approved Codex standalone executable and SHA-256 into the scheduler and revalidate both before child launch.
- Reject test-only environment controls in the production entrypoint; keep dependency injection in a separate test-only entrypoint.
- Disable user shell startup files before the launchd hardening command executes.
- Never merge, enable auto-merge, deploy, or mutate production/provider state.

## Verification

- Production-watch focused tests and tools TypeScript typecheck.
- Full repository-tools test suite.
- Strict JSON-schema tests, docs drift/gardening, skill validation, diff hygiene, and privacy/secret scans.
- Aggregate-only live preflight for all four production sources.
- ReviewGPT launch gate using the latest published package version.
- Scheduler install followed by a successful launchd collection and status/projection inspection.

## Rollback

Run the watcher scheduler uninstall command. This unloads only its managed launchd job; machine-local runtime state and coordination history remain for inspection.

## Progress

- The first reviewed head established the four-source collector, incident ledger, and self-contained launchd runtime.
- The correction pass removed the out-of-scope diagnosis, remediation, review, branch, and draft-PR lifecycle rather than leaving dormant code behind.
- Provider-child execution now ignores mutable user configuration, pins its model and effort, disables unrelated capabilities, and exposes only the pinned Cloudflare Observability MCP executable.
- Database collection has a deterministic one-session aggregate query with explicit cardinality tests. Subprocess cancellation now remains connected while waiting for the durable state lock.
- ReviewGPT is pinned to published version `0.5.126`; a fresh review of the corrected pushed head remains an activation gate.

## Decisions

- Keep this as one merge unit. The four collectors feed one strict snapshot contract, which feeds one state owner, scorer, incident ledger, projection set, and scheduler. Splitting those pieces would leave intermediate revisions that cannot complete a safe unattended monitor run.
- Keep incidents claim-and-escalate-only. The launchable CLI has no diagnosis session, remediation lease, repository mutation, ReviewGPT invocation, push, or PR path.
- Treat the Cloudflare Codex child as an adapter with a reviewed immutable capability contract, not as a general-purpose agent inheriting local preferences.

## Retrospective

The first-reviewed revision contained 10,747 lines of watcher source and 5,079 lines of tests and fixtures. Under the same classification, the corrected implementation contains 8,432 source lines and 4,814 test and fixture lines; 6,904 of the source lines are executable TypeScript and SQL, with the remainder in strict runtime schemas. The reduction came from deleting the unlaunchable fixer lifecycle and its classification state rather than abstracting it behind another layer. Remaining size is concentrated in explicit provider normalization, strict schemas, durable state transitions, process ownership, launchd lifecycle safety, and their failure-path tests.
