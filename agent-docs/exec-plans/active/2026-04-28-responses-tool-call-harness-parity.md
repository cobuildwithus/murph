# Responses Tool-Call Harness Parity

## Goal

Make the hosted-local Linq E2E harness reproduce the production Responses API continuation shape that failed after an immediate follow-up message, especially tool-call output handling through the Vercel AI Gateway Responses runtime.

## Scope

- Hosted-local assistant provider stub behavior for `/v1/responses`.
- Full-stack hosted-local Linq first-contact E2E coverage.
- Minimal assistant provider/runtime fixes only if the improved harness reproduces the production failure.

## Constraints

- Preserve production hosted provider config semantics: Vercel AI Gateway, `openai/gpt-5.5`, Responses API enabled, `store: true`, and no gateway-only provider filter unless explicitly configured.
- Do not print secrets or raw provider credentials.
- Do not overwrite unrelated active hosted, assistant-runtime, or Health Commons work.
- Keep persisted product truth out of assistant runtime; this task should not add persisted state.

## Verification

- Focused hosted-local Linq E2E covering immediate second reply with a Responses tool-call continuation.
- Focused unit coverage for any provider/stub request-shape helpers added.
- Relevant package/app typechecks for touched owners.
