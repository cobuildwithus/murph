# Remove unreachable Web prototype residue

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Remove five unreachable Web prototype/helper modules so the supported frontend surface no longer carries misleading mock, obsolete card, timeline, plan, or biomarker-binding implementations.

## Success criteria

- Every exported symbol and filename has no production, test, design-catalog, documentation, registry, or dynamic-loader consumer before deletion.
- The five requested files are deleted without changing reachable Web behavior.
- Focused Web typecheck, tests, negative reachability searches, diff checks, and privacy review pass; the production Web build either completes or records the exact unrelated setup/runner boundary reached.
- The task is closed in one scoped local commit without pushing or opening a pull request.

## Scope

- In scope: deleting the five explicitly requested `apps/web` source files; focused verification; local commit; draft PR evidence for the parent handoff.
- Out of scope: replacing these components, changing reachable UI, editing current design-catalog states, adding tests for unreachable code, pushing, opening a pull request, or remediating unrelated failures.

## Constraints

- Technical constraints: preserve every reachable Next.js App Router and React surface; confirm there is no string-based or directory-glob consumer; use the existing package scripts and frozen dependency graph.
- Product/process constraints: this is an internal-only cleanup with no Product UX promise, rendered state, provider input, hot reply path, persisted state, or deploy-order change. Use the sanctioned worktree, Frog inspection, Next.js and Vercel React best-practices guidance, and the repo commit wrapper.

## Risks and mitigations

1. Risk: a file is consumed through an indirect registry, design catalog, test helper, or dynamic import that a symbol-only search misses.
   Mitigation: search exact symbols, file stems, path strings, glob/directory loaders, active plans, and open pull-request file lists before deletion, then repeat negative searches after deletion and run Web typecheck/build.
2. Risk: another active pull request changes one of the same files.
   Mitigation: query open pull-request file lists immediately before editing and stop on any overlap.

## Tasks

1. [complete] Read repository and frontend workflow guidance plus the required Next.js and React best-practices skills.
2. [complete] Prove branch ownership, clean status, export unreachability, absence of dynamic/catalog consumers, and absence of active overlap.
3. [complete] Delete exactly the five requested files.
4. [complete] Run focused Web verification, negative searches, diff/privacy review, and compile PR evidence.
5. [complete] Close this plan and create one scoped local commit; do not push or open a pull request.

## Decisions

- Product UX: not applicable. The deleted modules have no reachable consumer, so no member journey or visible state changes.
- Design proof: not applicable. No production route, `/design` catalog state, or `/screenshots` study renders these modules.
- Changelog: not applicable because members cannot observe the deletion.
- Cross-cutting review: not applicable; this is frontend-only dead-source deletion with no runtime, persistence, authority, provider, backend, or deploy-boundary change.
- Historical owner proof: the old device card was replaced by `DeviceMetricRow`; the old plan card's final caller was removed; live trend, timeline-entry, billing-plan, and biomarker-schema owners remain intact. An independent read-only review found no deletion-safety issue.
- Frog: existing fresh-worktree Web preparation entry `#2378` covers the setup class encountered here; no new entry was created.

## Verification

- Passed: exact symbol, path, dynamic-loader, active-plan, and open-pull-request overlap searches. Twenty current open pull requests had zero exact-path overlap in the final check.
- Passed: `pnpm --dir apps/web typecheck` after canonical Health Commons and Prisma generation.
- Passed: focused Web Vitest selection covering design studies, device metrics, private trend, experiment detail, account settings, and Health Commons biomarker detail — 6 files and 71 tests.
- Passed: `pnpm --dir packages/hosted-execution build`, the fresh-worktree prerequisite needed by Web Prisma build preparation.
- Partial: `pnpm --dir apps/web build` passed preflight, generated assets, Prisma, a second Web typecheck, and Next route-type generation. The session-owned command was bounded and stopped after more than seven silent minutes in Next bundling; no compile error appeared, but a completed build result is unavailable.
- Passed: post-deletion negative searches, `git diff --check`, scoped privacy-pattern review, and final source diff review. The authored source change is exactly 230 deleted lines across the five requested files.
Completed: 2026-08-30
