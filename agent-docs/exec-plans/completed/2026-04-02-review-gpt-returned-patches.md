# Debug review-gpt wake download failures and roll out the upstream fix

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Determine why `cobuild-review-gpt thread wake` exported ChatGPT threads but failed to download returned patch attachments, ship the fix in `../review-gpt`, and consume the published release in Murph if the new version is required locally.

## Success criteria

- The wake/export/download failure is reproduced and narrowed to a concrete root cause with direct proof.
- `../review-gpt` contains the fix, passes its required checks, and a new published release is available.
- Murph consumes the fixed published version if local proof shows the installed consumer must move forward to restore wake downloads.
- Murph verification plus a direct wake/download scenario prove the consumer-side fix works.
- The active plan and coordination ledger reflect the debug-and-rollout lane rather than the abandoned patch-landing work.
- Unrelated in-flight worktree edits remain untouched.

## Scope

- In scope:
  - Murph wake outputs under `output-packages/chatgpt-watch/**`.
  - Root-cause analysis and proof in `../review-gpt`.
  - Upstream release/publish work for the review-gpt fix.
  - Murph consumer/version updates plus required verification if the published fix is needed locally.
- Out of scope:
  - Implementing the downloaded audit patches themselves.
  - Re-sending prompts or nudges to ChatGPT threads.
  - Reverting unrelated worktree edits.
  - Rolling every sibling consumer repo forward unless that becomes necessary to restore the broken workflow proven here.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits in both Murph and `../review-gpt`.
  - Fix the wake/download bug in the published package rather than via a Murph-local patch.
  - Keep Murph changes limited to the consumer rollout and related test/plan artifacts.
- Product/process constraints:
  - Verification must include at least one direct wake/download proof at the CLI boundary.
  - Keep commits narrowly scoped to the upstream release and the Murph consumer update.

## Risks and mitigations

1. Risk: The wake failure reproduces only in the full export-and-wake flow, so a direct-download-only fix gives false confidence.
   Mitigation: Prove the bug on `thread wake`, not just `thread download`, and verify the same wake path after the fix.
2. Risk: Murph appears fixed only because the local checkout runs the unpublished upstream source rather than the installed package.
   Mitigation: Re-test from Murph's installed binary after publishing `@cobuild/review-gpt`.
3. Risk: Consumer lockfile updates pull in broader peer-resolution churn.
   Mitigation: Keep the Murph rollout minimal, inspect the lockfile diff, and avoid unnecessary multi-repo bumps in the same turn.

## Tasks

1. Reproduce the failed wake/download path from the stored ChatGPT thread outputs and isolate the breakage.
2. Fix the root cause in `../review-gpt`, add regression coverage, and publish a new patch release.
3. Prove the published package fixes Murph's wake/download flow and update Murph if the installed consumer version must move.
4. Run Murph verification, required review, and a scoped commit for the consumer rollout.

## Decisions

- Treat the problem as an upstream package regression, not a Murph-local patching problem.
- Ship the fix in `../review-gpt` first, then validate Murph against the published package.
- Update Murph now because it was the failing consumer under direct proof; evaluate other sibling repos separately rather than widening this lane blindly.

## Current state notes

- Repro result:
  - `thread download` on the stored threads succeeds on current pages.
  - `thread wake` on `@cobuild/review-gpt@0.5.20` fails after export/reload with `Timed out waiting for matching CDP event after 30000ms`.
- Root cause:
  - The wake flow's export step refreshes the ChatGPT tab into a state where pure CDP mouse dispatch is not reliable for the returned attachment control, even though the control is visible.
  - DOM-level activation of the same attachment control works immediately in that post-export state.
- Upstream fix:
  - `../review-gpt` now activates the attachment control in-page first (`dispatchEvent` sequence plus `node.click()`), then falls back to the existing native click path.
  - Published as `@cobuild/review-gpt@0.5.21`.
- Murph rollout:
  - Bumped `@cobuild/review-gpt` to `^0.5.21`.
  - Rotated the version-scoped `minimumReleaseAgeExclude`.
  - Updated the CLI release-coverage audit test to derive the current review-gpt version dynamically.

## Verification

- Upstream `../review-gpt`:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm release:check`
  - Direct repro before fix: `thread wake --delay 0s --skip-resume` timed out on the attachment click path under `0.5.20`.
  - Direct proof after fix: the same wake commands downloaded the patch files successfully from the stored ChatGPT threads.
- Murph:
  - `corepack pnpm deps:guard`
  - `corepack pnpm deps:ignored-builds`
  - `corepack pnpm deps:audit` failed on pre-existing advisories, including `hono`, `@hono/node-server`, `effect`, and `path-to-regexp`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:coverage` failed on pre-existing coverage thresholds in `packages/hosted-execution/src/env.ts`
  - Direct proof: `corepack pnpm exec cobuild-review-gpt thread wake --delay 0s --skip-resume --chat-url <thread-url> --output-dir output-packages/chatgpt-watch/murph-review-gpt-0.5.21-proof` downloaded the returned patch successfully.

## Open questions

- No open implementation question for Murph. Remaining question is rollout scope: whether other sibling repos should be bumped in separate per-repo tasks rather than widened into this already-verified Murph lane.
Completed: 2026-04-02
