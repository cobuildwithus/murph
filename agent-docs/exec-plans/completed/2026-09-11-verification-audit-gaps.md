# Close verification inventory, routing, and timezone gaps

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Close the seven confirmed verification audit gaps: empty/overlapping hosted test selections, omitted Node tests and cold recovery, diff routing, acceptance tool coverage, and PostgreSQL UTC sessions.

## Success criteria

- Actual test collection rejects empty, omitted, and duplicate process assignments before stack startup.
- Every audited test has an automatic owner; selected CLI and smoke checks execute through the real dispatcher.
- Prisma reads the same synthetic instant with UTC and non-UTC connection defaults.
- Focused tests, typechecks, candidate review, required CI and routed final review pass; open a reviewable PR.

## Scope

- In scope: existing hosted harness, repository verification scripts/workflows, Prisma pool configuration and focused regression tests.
- Out of scope: production access or deployment; unrelated shared-checkout changes.

## Constraints

- Keep existing test runners, retry owners, database pool and workspace entrypoints. No dependencies or schema changes.
- Use synthetic data; preserve test isolation and native process ownership. Retain an open PR worktree.

## Risks and mitigations

1. Test collection can drift from execution. Use installed Vitest collection with the same scenario environment and validate the complete declared process partition.
2. Connection-string options override pool defaults. Preserve other options while making UTC authoritative at connection startup; prove through the real adapter.

## Tasks

1. Revalidate audit findings against current main and inspect existing owners.
2. Fix local selection/routing and register omitted tests at existing automatic owners.
3. Enforce UTC during connection startup and prove real PostgreSQL behavior.
4. Run focused verification and cold recovery; review, commit, push, open PR and complete CI/review gates.

## Decisions

- The original audit is diagnostic evidence; current source determines implementation.
- Shared checkout has unrelated work. A clean completed foreground fixture checkout passed guarded retirement, freeing the sanctioned task slot.

## Verification

- Focused repository-tool and harness tests; Web Prisma unit and local PostgreSQL tests; relevant typechecks; complexity guard; registered cold-recovery E2E.
- All focused checks pass and regression cases reject the old behavior. Required CI owns broad proof.

## Progress

- Implemented seven audit corrections. Cold recovery requires a small private scenario-manifest companion.
- Passed: 47 composed verification tests; Node inventory and cross-repository guard tests; 89 Prisma unit cases; real PostgreSQL timezone proof; 33 harness orchestration cases; real Vitest selection regression; Web, harness and repository-tool typechecks.
- Complexity guard passes. Existing Prisma error classification and diff summary hotspots remain unchanged in complexity.
- Cold recovery passed through the full local stack, preserving the 25-second import deadline and actual provider reply. Removed the obsolete timeout override and replaced a retired log event observer with the canonical conversation import watermark.
- Private companion full verification and its 12 manifest selection tests passed.
- Current foreground and scheduled-reminder partitions passed actual Vitest collection. Cloudflare and repository-tool typechecks passed after the final fixture correction.
- Local implementation and candidate review are complete. Public PR #3332 and private companion #139 retain external review and exact-head CI gates; no merge or deployment is included.
Completed: 2026-09-11
