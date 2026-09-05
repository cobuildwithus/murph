# Load public-page authentication on intent

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Reduce unnecessary authentication JavaScript on public pages while preserving sign-in, OAuth return, consent, and sign-out recovery.

## Product UX

- Outcome: Browse public pages without downloading sign-in code until there is intent to authenticate.
- Reaches: Signed-out visitors on phone and desktop; signed-in sidebar users signing out; cold and warm sign-in, failed chunk downloads, and Telegram OAuth returns.
- Proof: Focused component tests, browser resource and interaction evidence, Web typecheck, required exact-head CI and ReviewGPT.

## Architecture and decisions

The auth dialog and homepage runtime loader already own dynamic loading, intent, retry, and session stability. Delete their automatic idle warmups and obsolete opt-in props. Retain pointer, keyboard focus, and click preparation. The sidebar owns authoritative app logout: resolve the deferred logout component before clearing that session, so a chunk failure uses the existing retry state. Keep Privy readiness and best-effort cleanup with their existing owner. No new dependency or generic loader.

## Success criteria

- Passive public browsing does not trigger auth warmups.
- Intent prepares one shared runtime and open dialogs retain their active runtime.
- Failed chunk or app logout permits retry; successful logout clears the app session, runs Privy cleanup, and refreshes.
- Existing auth accessibility, consent and OAuth tests pass.
- Browser evidence shows the deferred graph and usable cold sign-in.

## Scope

Auth loading only. Experiment image sizing has a separate PR. Audit server delays were variable and do not establish a specific server defect; preserve existing bounded concurrent reads and cache policies.

## Tasks

1. Delete idle warmups and defer sidebar logout import.
2. Update behavioral regression coverage and release note.
3. Run focused tests, typecheck, lint, complexity and browser proof.
4. Parent review, close plan, push draft PR, mark ready, start ReviewGPT concurrently with CI, resolve results.

## Verification

- Focused auth suite: 12 files, 189 tests passed, including cold/warm runtime, chunk retry, sidebar logout, OAuth return, consent and focus accessibility.
- Sidebar and changelog recheck: 2 files, 35 tests passed.
- `pnpm --dir apps/web typecheck` initially found the existing fresh-worktree `@murphai/device-syncd/service` build-artifact gap. After `pnpm --dir packages/device-syncd build`, `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm complexity:diff`: passed; AuthDialog remains at the pre-existing 22, preserving its consent, accessibility and recovery branches. Auth control and nav complexity decreased. No justified additional abstraction.
- `pnpm test:frontend-design-proof`: 12 tests passed.
- `pr-public-auth-loading-design-proof.spec.ts`: 2 browser tests passed at 412px and 1440px. Fresh navigation to experiments, goals and homepage leaves actual Privy/WalletConnect/Reown chunks unloaded after five idle seconds. The small Turbopack async-loader descriptor is distinguished from the SDK. Signup renders the real dialog and phone field. Native crops inspected at both widths.
- Browser external requests were blocked and the SDK used smoke configuration. This proves download boundaries and cold form rendering, not external provider authentication or a production Speed Insights score.
- Public baseline diagnostic evidence showed about 749KB of avoidable auth transfer on goals, knowledge and search. Production score and exact deployed bundle bytes require post-deployment comparison.

## Product UX walkthrough

Ready: passive mobile and desktop browsing, cold form entry, focus/touch preparation, stable active runtime, OAuth return, and failed chunk/app logout retry are covered at their changed boundaries. Existing authentication, consent and readiness owners remain intact. No new server waits or cache policies.

## Review handoff

PR #2909. Final review and exact-head CI are tracked on the PR. This plan records implementation and local proof; it does not assert those external gates have passed.
Completed: 2026-09-05
