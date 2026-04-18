# Hosted hard-cut guide v2 audit and cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Compare the current hosted codebase against the new cutover guide and decide
  whether any meaningful hard-cut work still remains.
- Use five parallel review lanes over distinct hosted ownership seams, dedupe
  the findings against the actual code, and land only the remaining cleanup
  that is still real.

## Success criteria

- The guide is checked against the real code paths rather than docs alone.
- Review findings are partitioned by ownership seam so duplicates and stale
  claims are obvious.
- Any remaining hard-cut gaps that are safe to land without reopening active
  unrelated lanes are implemented, verified, audited, and committed.

## Scope

- In scope:
  - hosted wake/cursor ownership in `apps/web`
  - hosted producer append paths across onboarding, messaging, share, and
    device-sync flows
  - Cloudflare execution-plane ownership and remaining queue/dispatch residue
  - hosted runtime contract and message-vs-system execution boundaries
  - hosted docs that still claim stale queue or dispatch ownership
- Out of scope unless a finding proves they are required:
  - unrelated Cloudflare e2e stabilization work already tracked in the active
    `2026-04-18-cloudflare-e2e-stabilization.md` lane
  - release-manifest and lockfile work already tracked in the active
    `2026-04-18-release-patch-green.md` lane
  - broad package-boundary cleanups unrelated to hosted hard-cut ownership

## Constraints

- Preserve unrelated dirty-tree edits and active ledger rows.
- Prefer small deletion-oriented cleanup over new compatibility layers.
- Avoid overlapping the active e2e and release lanes unless a remaining
  hard-cut bug cannot be fixed anywhere else.

## Tasks

1. Read the guide and current hosted architecture docs, then map the review
   seams.
2. Spawn five `gpt-5.4` high-reasoning review subagents over disjoint hosted
   slices.
3. Dedupe the findings locally and classify them as already landed, stale, or
   still real.
4. Implement the remaining real cleanup, run the required verification and
   audit passes, and commit the scoped batch.

## Review lanes

1. Web wake/cursor substrate and append/commit routes
2. Hosted producers and webhook/message/email ingress paths
3. Cloudflare thin-runner, lease, queue, and storage ownership
4. Assistant runtime contract and message/system execution split
5. Durable docs, guides, and architecture alignment against the code

## Verification

- Start with focused static/code review to decide whether edits are needed.
- If code changes land, prefer truthful owner-level verification via
  `pnpm test:diff <changed paths ...>` and any focused hosted package/app checks
  needed to support that lane.
Completed: 2026-04-18
