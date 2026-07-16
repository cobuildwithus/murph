# Hosted diagnostic redaction owner

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make `@murphai/hosted-execution` the single owner of hosted diagnostic
  free-text redaction while preserving the current privacy behavior exactly.

## Success criteria

- Cloudflare and assistant-runtime import the shared free-text helpers from
  `@murphai/hosted-execution`.
- Both byte-identical local helper modules are deleted.
- The unused Cloudflare structural diagnostic object walker and its test are
  deleted rather than moved.
- Surviving free-text and error-cause behavior is covered at the shared owner.
- Structural persisted-JSON allowlisting remains unchanged and separate.

## Scope

- In scope: hosted-execution observability exports/tests, the two consuming
  imports, deletion of the duplicate helper modules, and deletion of the dead
  Cloudflare-only walker test.
- Out of scope: persisted JSON parsers, callback transport helpers, runtime
  protocols, deploy configuration, and durable architecture documentation.

## Constraints

- Preserve the helper implementation and output byte-for-byte during the move.
- Add no dependency or compatibility layer; both consumers already depend on
  `@murphai/hosted-execution`.
- Do not commit or push in this delegated implementation pass.

## Risks and mitigations

1. Risk: a redaction expression changes subtly while moving owners.
   Mitigation: move the implementation verbatim and port all surviving tests.
2. Risk: the specialized free-text contract is conflated with structured-log
   or persisted-JSON sanitization.
   Mitigation: retain its distinct exported names and leave both other policy
   surfaces untouched.
3. Risk: package-level import resolution differs across consumers.
   Mitigation: run focused owner/consumer tests and truthful diff verification
   for hosted-execution, assistant-runtime, and Cloudflare.

## Tasks

1. Add the two shared helpers to hosted-execution observability.
2. Port the surviving behavior tests to hosted-execution.
3. Update Cloudflare and assistant-runtime imports and delete duplicate modules.
4. Run stale-reference, privacy, diff, focused-test, and diff-verification checks.

## Verification

- Focused hosted-execution observability tests.
- Focused assistant-runtime and Cloudflare tests covering affected callers.
- `pnpm test:diff` for the three touched owners.
- `git diff --check` and secret-safe identifier/stale-reference scans.

Completed: 2026-07-15
