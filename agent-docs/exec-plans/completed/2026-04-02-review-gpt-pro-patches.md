# Apply returned review-gpt Pro patches from all eight audit presets

Status: completed
Created: 2026-04-02
Updated: 2026-04-03

## Goal

- Wait for the eight autosent `review:gpt` audit threads to finish, download any returned `.patch` or `.diff` attachments, integrate the valid deltas into the live repo without overwriting unrelated dirty-tree work, then complete repo-required verification, audit, and commit flow.

## Success criteria

- The exact ChatGPT thread URLs for the eight autosent presets are recovered and tracked.
- Returned patch or diff attachments are downloaded for completed threads, inspected, and applied or manually ported where needed.
- Integrated changes preserve adjacent in-flight edits and stay within the behavioral intent of the returned audit patches.
- Required verification is run after the integrated implementation stabilizes, with any unrelated baseline failures called out explicitly if they remain.
- Required `task-finish-review` audit runs on the final diff before handoff.
- The task is closed with the plan moved out of `active/` and a scoped commit containing only the touched paths.

## Scope

- In scope:
- Recovering the eight active review-gpt thread URLs created by the autosend runs.
- Waiting for thread completion and downloading returned patch or diff attachments.
- Applying or manually porting returned patch deltas into the current tree.
- Conflict resolution, direct verification, final audit, and scoped commit flow for the landed review-driven changes.
- Out of scope:
- Launching additional new review presets unless a returned thread is unusable and the user asks for a rerun.
- Unrelated cleanup outside the returned patch intent.

## Constraints

- Technical constraints:
- The live worktree is already dirty with many active lanes; preserve unrelated edits and do not revert or overwrite them.
- The review-gpt launcher previously reported only `https://chatgpt.com/`, so the actual thread URLs must be recovered before any wake/export/download flow can proceed.
- Returned patches may not apply cleanly and may require manual porting onto the current tree.
- Product/process constraints:
- Follow repo completion workflow, including required final audit subagent, verification, plan closure, and scoped commit.
- Keep personal identifiers out of written artifacts and handoff text.

## Risks and mitigations

1. Risk: Recovered ChatGPT tabs may not map cleanly back to the eight autosent presets.
   Mitigation: Cross-check thread timestamps, prompt contents, and any downloaded artifact names before applying anything.
2. Risk: Returned patches overlap active in-progress repo work and fail to apply cleanly.
   Mitigation: Read current file state first, manually port only the intended deltas, and avoid reverting adjacent edits.
3. Risk: Some threads may return prose only or no attachment.
   Mitigation: Treat missing attachments as a stop condition for that thread, record the status, and only continue with threads that produced concrete patch artifacts.

## Tasks

1. Recover and map the eight ChatGPT thread URLs for the autosent preset runs.
2. Wait for thread completion and download returned patch or diff attachments into local review-artifact storage.
3. Inspect each returned patch, determine applicability, and integrate valid deltas into the current tree.
4. Run required verification and direct proof for the integrated changes.
5. Run the required final `task-finish-review` audit, address any high-severity findings, rerun affected checks, then finish the task with a scoped commit.

## Decisions

- Use a plan-bearing workflow because this is a multi-thread, multi-file external patch landing with likely conflict resolution.
- Treat each returned patch as intent, not overwrite authority, because the live repo already contains many overlapping dirty-tree changes.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Additional focused commands based on the returned patch surface, once known.
- Expected outcomes:
- Required checks pass, or any remaining failures are documented as credibly unrelated pre-existing baselines.
Completed: 2026-04-03
