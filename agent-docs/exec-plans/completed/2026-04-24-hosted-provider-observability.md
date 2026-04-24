# Hosted Provider Observability

## Goal

Expose enough privacy-bounded hosted runtime evidence to distinguish:

- provider/gateway request rejection before token generation,
- assistant automation skip/no-op after inbound conversation messages,
- downstream delivery failures after provider success.

## Scope

- Add sanitized OpenAI-compatible provider failure diagnostics.
- Forward those diagnostics through hosted assistant notification run-log entries.
- Persist compact hosted assistant automation pass summaries into run results.
- Keep raw prompts, request bodies, headers, credentials, and provider payloads out of logs.

## Verification

- Focused hosted-execution, assistant-engine, and assistant-runtime tests.
- Package-local typecheck for touched packages where feasible.

Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
