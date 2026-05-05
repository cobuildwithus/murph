# Codex Resume Failure Structural Trace

## Goal

Make hosted Codex resume-failure diagnostics emit for production failures that carry structured Codex error data but may not satisfy a local `VaultCliError instanceof` check.

## Constraints

- Preserve redacted, metadata-only diagnostics.
- Do not log raw prompts, messages, transcripts, tool outputs, provider payloads, API keys, headers, filesystem paths, or user identifiers.
- Runtime log key validation should be blacklist-oriented and allow metadata-only key suffixes without one-off safelist churn.
- Keep behavior scoped to diagnostics; do not change provider execution or fallback policy.
- Preserve unrelated dirty work in the checkout.

## Plan

1. Use structural `code` detection for Codex diagnostic trace eligibility.
2. Let hosted runtime log parsers accept metadata-only keys such as `*MessageLength` while continuing to reject raw sensitive value keys such as `messageText`.
3. Add focused regression coverage for a non-`VaultCliError` object carrying `ASSISTANT_CODEX_FAILED` and Codex failure context.
4. Run focused tests and typecheck for touched owners.
5. Run required completion audits for hosted runtime observability.
6. Commit only the scoped diagnostics fix and plan closure.

## Verification

Pending.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
