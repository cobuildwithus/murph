# Hosted RSC Boundary Cleanup

## Goal

Shrink the remaining hosted web client boundaries so share, join success, settings billing, and settings device sync render server-first where possible while preserving the current Privy cookie-backed behavior and the same user-visible flows.

## Scope

- `apps/web/app/settings/page.tsx`
- `apps/web/app/join/[inviteCode]/success/page.tsx`
- `apps/web/app/share/[shareCode]/page.tsx`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/src/components/hosted-share/**`
- `apps/web/src/components/settings/**`
- `apps/web/src/lib/device-sync/settings-surface.ts`
- targeted hosted-web tests

## Constraints

- Do not change route auth semantics, billing/device-sync route contracts, or Privy cookie verification.
- Keep browser-only work limited to actions, polling, URL cleanup, and redirects.
- Preserve unrelated worktree edits outside this lane.
- Verification must follow the `apps/web` lane from `agent-docs/operations/verification-and-runtime.md`.

## Design

1. Make share and join-success files server-render the card shell while moving polling and button actions into smaller client islands.
2. Server-prefetch the initial device-sync settings payload and hydrate it into a narrower client controller.
3. Turn billing into a server-rendered card with a tiny client portal button.
4. Remove leftover unnecessary `'use client'` directives from shared presentation leaves that no longer need client-only status.

## State

- Done: share page now uses a server shell plus a smaller client island.
- Done: join-success page now uses a server shell plus a smaller client island.
- Done: shared preview presentation was split into a server-safe leaf.
- Done: targeted Vitest checks for the touched hosted-web files passed.
- Blocked: repo typecheck still fails in `apps/web/app/settings/page.tsx` on an unrelated pre-existing settings-worktree edit.
- Next: continue the remaining settings/billing narrowing in this broader plan when that lane is picked back up.

## Verification

- `pnpm test:diff ...` if it truthfully covers the touched `apps/web` slice; otherwise the required `apps/web` verification lane.
- required completion-workflow audit passes before handoff.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
