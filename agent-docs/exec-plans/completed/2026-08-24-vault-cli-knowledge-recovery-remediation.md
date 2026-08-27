# Vault CLI Knowledge Recovery Remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Close two candidate-review defects before PR review: fail closed when lower
owners receive an absolute or otherwise unsafe source path, and distinguish a
retryable Exa response-body transport failure from terminal malformed JSON.

## Proven Causes

- Query and memory path sanitizers replace backslashes and strip leading
  separators before deciding whether a path is relative. Absolute Unix,
  Windows-drive, and UNC inputs can therefore become model-visible
  pseudo-relative paths.
- The Exa response-body catch assigns every `response.json()` failure the same
  stage, so terminal `SyntaxError` JSON parsing and retryable body-stream
  transport failures receive the same terminal classification.

## Architecture

- Validate the raw path first, accept only bounded vault-relative POSIX paths,
  then normalize and revalidate the result. Unsafe values collapse to the
  existing owner-specific placeholder rather than exposing path fragments.
- Retain `response_body` for retryable transport/read failures and add a
  terminal malformed-JSON stage. Caller abort and timeout retain priority.
  Continue projecting only bounded error names and safe transport facts.
- Inspect the query runtime Proxy for a concrete current-surface failure; leave
  it unchanged without evidence.

## Product UX Patch

- A model sees a canonical placeholder rather than any fragment of an absolute
  local path.
- A model retries a 2xx response whose body stream failed, but does not loop on
  malformed provider JSON or an invalid successful response shape.

## Verification

- Direct owner tests cover Unix, Windows-drive, UNC, traversal, control
  characters, and valid canonical relative paths without echoing unsafe input.
- Exa tests cover response-body transport, malformed JSON, caller abort,
  timeout, and malformed response shape with final retryability decisions.
- Run focused package tests and typechecks, inspect the Proxy, final diff,
  privacy boundary, and categorized LOC, then create a scoped commit.

## Progress

- Resumed the clean owned branch at the exact integration candidate head.
- Confirmed both review findings in the current code and found no overlapping
  local edits.
- Path owners now validate raw input before normalization and collapse Unix,
  Windows-drive, UNC, traversal, control-character, URI-like, overlong, and
  non-canonical segmented paths to the existing safe placeholder. Direct tests
  preserve valid canonical paths and prove unsafe markers do not echo.
- Exa now classifies a 2xx body transport/read failure as retryable provider
  unavailability, while `SyntaxError` JSON and invalid success shape remain
  terminal. Body-phase caller abort and timeout keep priority, and projected
  metadata remains limited to stage, status, flags, and bounded error name.
- Inspected every current wrapper owner and consumer. They invoke exported
  query functions directly and use native promises; no function-identity,
  constructor, receiver, or thenable requirement is present, so the Proxy was
  left unchanged.
- Focused tests passed for query, contracts, and CLI. Typechecks passed for
  query, contracts, vault-usecases, and CLI.
Completed: 2026-08-24
Completed: 2026-08-24
