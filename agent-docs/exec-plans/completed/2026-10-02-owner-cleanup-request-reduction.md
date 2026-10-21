# Reduce redundant idle cleanup owner reads

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Goal

- Reduce idle-cleanup owner callbacks without changing artifact, media, snapshot,
  launch, or completion authority.

## Success criteria

- Locally blocked cleanup does not call Web; eligible cleanup retains the remote
  owner gate outside the lifecycle lock and repeats local checks under the lock.
- Completion identity rejection and receipt reasons remain unchanged.
- Focused Cloudflare tests, app typecheck, and complexity diff pass.

## Scope

- In scope: completion preflight assessment, native idle-cleanup ordering, focused
  request-count and race proof, owner documentation, and the requested report.
- Out of scope: caching fences, changing Web protocols, production, commits/PRs.

## Constraints

- Postgres remains authority; local health may defer a stop but never grant it.
- Use the existing task checkout only. Leave all changes uncommitted for the parent.

## Risks and mitigations

1. New work may arrive during either local health or remote ownership reads.
   Mitigation: preserve interaction fencing and locked local revalidation.
2. A completed native receipt does not prove canonical completion.
   Mitigation: preserve the preflight because Web's complete result lacks the
   facts needed for already_completed, superseded, and owner_unconfirmed.

## Tasks

1. Trace native routing, receipt ownership, completion results, and idle timing.
2. Move local cleanup vetoes before Web; retain the locked checks.
3. Add request-count and race tests, and document the unchanged completion seam.
4. Run focused tests, typecheck, complexity, and privacy/diff review; close plan
   without committing and overwrite the requested report.

## Decisions

- The platform caller could route to its controller, and exact identity is
  checked by native receipts and Web. The third completion-removal condition
  fails: stale completion responses contain no owner facts, and local receipts
  are completed before Web responds. Keep the completion preflight.
- Reuse canStopWarmContainer before Web instead of adding a cache or scheduler.
  A future receipt deadline defers directly to that deadline; uncertain or
  remotely denied cleanup after the deadline retains the existing 60s retry.

## Verification

- Cloudflare Node suites for runner fleet lifecycle, runner container, outbound
  requests, and composed completion: 699 tests passed. The first run exposed two
  old one-health-read assertions; updated them for preflight plus locked recheck,
  and kept final-status race tests at the actual final read.
- apps/cloudflare typecheck passed after the expected fresh-checkout Prisma
  generation. Initial failure was missing Prisma/PrismaClient generated exports.
- pnpm complexity:diff passed; existing complexity debt and maximum unchanged.
- Tests show zero owner reads before the receipt deadline, fresh 60-second
  retries after deadline denial, final local vetoes after remote permission, and
  unchanged completion reasons from identical completed native receipt states.
- Only controller logic changes; old containers retain health compatibility,
  and Web/Temporal protocols and all artifact/media/snapshot fences are unchanged.
- No public changelog: this is internal request reduction without changed member
  behavior. Parent owns commits, PR review, and deployment.
Completed: 2026-10-02
