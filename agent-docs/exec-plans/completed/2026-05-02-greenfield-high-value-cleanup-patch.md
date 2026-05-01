# Land greenfield high-value cleanup patch

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied cleanup patch intent on current `murph` main while
  preserving unrelated dirty work.

## Success criteria

- Device-sync secure-box credential encrypt/decrypt helpers accept the caller's
  Prisma transaction where needed.
- Legacy hosted/device crypto codec modules are quarantined outside active app
  and test import paths.
- Hosted crypto hard-cut guard no longer allowlists legacy codec paths.
- Cloudflare mailbox decrypt fails closed without legacy environment fallback.
- Assistant-runtime hosted env denylist uses the wake prefix rather than
  enumerating old wake names.
- Focused and required verification/review passes are run, or unrelated
  blockers are documented precisely.

## Scope

- In scope:
  - The exact files represented by the supplied patch.
  - Minimal manual hunk adjustment for current-tree drift.
- Out of scope:
  - Wider mailbox AAD/append/decode contract restructuring.
  - New crypto envelope formats or migrations.
  - Broad hosted wake/runtime behavior changes outside the patch intent.

## Constraints

- Preserve unrelated dirty working-tree edits and active plan lanes.
- Do not expose local paths, usernames, secrets, raw message bodies, or personal
  identifiers in code, docs, logs, examples, commits, or handoff.
- Treat hosted crypto, mailbox, and Cloudflare runner behavior as high-risk and
  fail closed on missing authority.

## Risks and mitigations

1. Risk: Stale patch hunks hide current behavior that should be preserved.
   Mitigation: Inspect current files and apply the behavioral intent manually
   instead of forcing rejected hunks.
2. Risk: Transaction plumbing diverges from the existing hosted crypto fix lane.
   Mitigation: Keep device-sync Prisma-store changes narrow and avoid touching
   unrelated hosted onboarding crypto files.
3. Risk: Verification is expensive in the dirty checkout.
   Mitigation: Run the required high-signal checks and record any unrelated
   pre-existing failures with exact commands.

## Tasks

1. Inspect patch hunks and current affected files.
2. Apply the patch intent to current files.
3. Run static review and privacy/diff checks.
4. Run required verification plus completion audit passes.
5. Close the plan and create a scoped commit if safe.

## Decisions

- Treat the supplied patch as intent, not overwrite authority, because two
  hunks are stale against the current checkout.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - Focused affected owner tests where useful.
  - `git diff --check`

Latest:

- Not run yet.
Completed: 2026-05-02
