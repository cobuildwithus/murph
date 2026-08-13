# PR #1705 final review

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Finish the exact-message current-sender group-chat change through its required final review, exact-head CI, and merge boundary.

## Success criteria

- Clarification replacement remains causally monotonic and resolved pointers cannot reopen on replay.
- Group notice targeting resolves an earlier exact accepted message after later live input arrives.
- Durable owner docs describe natural audience inference and clarification instead of retired phrase classification.
- Focused Web, assistant-runtime, PostgreSQL, type, documentation, and privacy checks pass.
- The final ReviewGPT gate passes, required exact-head CI is green, and the PR reaches the repository-authorized merge boundary.

## Scope

- In scope: accepted final-review findings, focused regression coverage, durable contract alignment, review/CI evidence, and PR packaging.
- Out of scope: unrelated messaging changes, a new delivery service, or broad provider transport redesign.

## Constraints

- Keep exact source identity and Web-owned sender/route authority.
- Preserve natural model intent inference and conversational clarification.
- Do not add state or retry machinery that cannot provide a real provider-level guarantee.
- Preserve the already-consumed base-update budget unless the user grants new authority.

## Tasks

1. Verify and commit the accepted round 13 remediation.
2. Run the next sensitive full-snapshot ReviewGPT round and resolve qualifying findings.
3. Require exact-head CI, prove the current-base merge result, and complete the authorized PR path.

## Verification

- Focused current-sender Web and PostgreSQL tests.
- Focused assistant local-runtime tests and package typechecks.
- Documentation drift and privacy checks.
- ReviewGPT full-snapshot PASS and required GitHub checks on the exact head.
