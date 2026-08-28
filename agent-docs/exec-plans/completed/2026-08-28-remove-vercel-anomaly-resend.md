# Remove duplicate Vercel anomaly Resend alerts

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove the duplicate Vercel-anomaly-to-Resend webhook introduced by PR #2489 now that Vercel's built-in email notifications already satisfy the operational need.

## Success criteria

- The webhook route, handler, focused tests, environment example, and live feature-specific documentation are removed.
- Shared Resend operational email ownership remains unchanged for other alerts.
- The inverse diff is limited to PR #2489's live owned surface plus this plan; its immutable completed plan and the subsequently reused index verification date remain intact.
- Focused verification, exact-head review, and required CI pass before merge.
- The revert is merged, the production route is no longer present after deployment, and the task worktree is retired.

## Scope

- In scope: delete PR #2489's Vercel alert webhook implementation, tests, configuration example, and live durable documentation.
- Out of scope: Vercel's native alert configuration, existing Resend-backed operational alerts, unrelated production alerting behavior, the immutable completed plan for the original work, and the shared documentation index date.

## Constraints

- Technical constraints: preserve shared Resend primitives and configuration; remove only the feature-specific external ingress surface; do not access or mutate production secrets.
- Product/process constraints: use the isolated worktree/PR lane, preserve unrelated changes since the original merge, and retain exact-head review and CI evidence.

## Risks and mitigations

1. Risk: an exact reverse patch could remove later edits in shared documentation.
   Mitigation: remove only the currently identifiable PR #2489 paragraphs and compare the final diff with the original merge patch.
2. Risk: deleting shared operational email code could break other alert paths.
   Mitigation: delete only Vercel-specific files and references; verify shared Resend owners remain untouched.
3. Risk: production may retain an obsolete webhook or secret after code removal.
   Mitigation: document that the Vercel webhook should remain unconfigured or be removed before deleting any optional environment variable; verify the deployed route disappears after merge.

## Tasks

1. Inspect the exact PR #2489 patch and all current live references.
2. Remove the Vercel-specific route, handler, tests, configuration example, and documentation without touching shared Resend alerting.
3. Run focused checks and compare the resulting patch to the original feature diff.
4. Commit, open a draft PR, and run the applicable ReviewGPT gates with exact-head CI.
5. Resolve findings, close the plan, merge, verify deployment, and retire the worktree.

## Decisions

- This is an operational deletion with no member-facing Product UX change.
- The final ReviewGPT gate applies because the deletion removes a signed external runtime entrypoint and production secret contract.
- No changelog entry is required because the removed feature was operational and never activated for members.
- Preserve PR #2489's immutable completed plan and the shared index verification date; neither is live runtime authority.
- The current live deletion exactly matches PR #2489's additions across the ten implementation, test, config, and live-doc paths.

## Verification

- Passed locally: `pnpm --dir apps/web typecheck`.
- Passed locally: `pnpm --dir apps/web lint` with 46 pre-existing warnings and zero errors.
- Passed locally: `pnpm docs:drift`.
- Passed locally: focused Vitest for `hosted-operational-alert-email-config` and `hosted-resend-plain-text-email` (2 files, 17 tests).
- Passed locally: exact inverse comparison against PR #2489's ten live paths, stale-reference scan outside execution plans, privacy scan, and `git diff --check`.
- Passed: final ReviewGPT round 1 full-patch audit with no findings. No preliminary specialist lens applied because this backend deletion made no Product UX, prompt, frontend, or material non-owner proof change.
- Passed: all required exact-head GitHub checks, including Pull Request Evidence, release checks, hosted billing, Temporal compatibility, and Vercel.
- Remaining: current-base merge-tree proof, merge, production route-absence check, and worktree retirement.
Completed: 2026-08-28
