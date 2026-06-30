# PR 222 Main Conflict Resolution

## Goal

Resolve PR 222 (`codex/hosted-family-plan`) against current `origin/main` and leave the branch mergeable without weakening hosted billing, privacy, runtime, or Cloudflare execution boundaries.

Success criteria:
- `origin/main` is merged into the PR branch with conflicts resolved.
- Family plan behavior remains owner-paid/member-private, with sponsored access gates intact.
- The conflict resolution stays narrow and avoids new abstractions or compatibility residue unless the merged code path already requires them.
- Focused verification covers the touched hosted web and Cloudflare surfaces.

## Constraints

- Preserve unrelated active-plan and worktree edits.
- Do not expose secrets, local usernames, home paths, or direct personal identifiers in files, logs, docs, or commits.
- Keep hosted product truth in `apps/web`; keep `apps/cloudflare` execution-only.
- Treat billing, auth/session, mailbox/runtime access, and family privacy as high-risk boundaries.

## Current State

- PR branch: `codex/hosted-family-plan`.
- Base: `origin/main`.
- GitHub reports PR 222 as conflicting.
- Active hosted lanes overlap some touched areas; resolve by following current `main` ownership and preserving PR 222's Family-specific behavior.

## Plan

1. Merge `origin/main` into the PR branch.
2. Inspect every conflicted file and nearby call path before choosing a side.
3. Resolve conflicts with the smallest durable code shape.
4. Run focused hosted web/Cloudflare checks, then broader required checks as feasible.
5. Finish with scoped commit and push the PR branch.

## Verification Target

Start with conflict-driven checks:
- `pnpm typecheck`
- `pnpm test:diff <resolved files>`

Escalate to `pnpm verify:acceptance` only if the conflict surface or failures require the full lane.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
