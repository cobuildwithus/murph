# PR 613 ReviewGPT fixes

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Make automatic meal-photo retries ownership-safe and keep cleanup available after access revocation.

## Success criteria

- Each staging attempt has a distinct private object key.
- Exact duplicate mailbox appends retain one canonical object and delete only the losing attempt.
- Ambiguous append cleanup never deletes an object already claimed by the mailbox.
- Object deletion does not require encryption-context discovery.
- Focused tests, typechecks, CI, and ReviewGPT pass.

## Scope

- In scope: meal-photo staging/deletion, mailbox canonicalization, upload cleanup, focused tests, and matching architecture/security/reliability docs.
- Out of scope: deployment orchestration changes and unrelated mailbox behavior.

## Constraints

- Keep the existing mailbox row as the only canonical handoff.
- Add no new service, queue, persisted state, or dependency.

## Risks and mitigations

1. A failed overlapping request deletes the accepted bytes.
   Mitigation: attempt-owned keys plus mailbox-claim reconciliation before cleanup.
2. Revoked access prevents cleanup.
   Mitigation: derive the per-user object path directly without resolving encryption keys.

## Tasks

1. Implement the two accepted ReviewGPT corrections.
2. Add focused race, ambiguity, and cleanup regression coverage.
3. Verify, audit, commit, push, and complete CI plus ReviewGPT.

## Decisions

- The first accepted mailbox item owns the canonical staged object for exact duplicates.
- An unreadable mailbox claim is treated as ambiguous and retained for lifecycle cleanup.

## Verification

- Focused web and Cloudflare Vitest suites.
- Web and Cloudflare typechecks plus scoped lint.
- Documentation drift/gardening and diff hygiene.
- GitHub CI and ReviewGPT on the exact pushed head.
Completed: 2026-07-13
