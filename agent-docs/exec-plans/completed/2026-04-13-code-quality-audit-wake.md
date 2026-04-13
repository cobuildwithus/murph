# Land watched code-quality audit patch and request same-thread follow-up review

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Land the returned `murph-code-quality-audit.patch` changes if they still apply to the current tree, verify the touched owners truthfully, then send the required same-thread follow-up review request and arm the final wake hop.

## Success criteria

- The patch intent is applied narrowly to the three targeted files only.
- Required scoped verification for `apps/cloudflare`, `packages/assistant-engine`, and `packages/hosted-execution` is run, with unrelated blockers called out separately if encountered.
- Required completion-workflow audit passes are completed and any resulting fixes are reverified.
- The same-thread review request is sent with attached files and the depth-0 wake command is armed.

## Scope

- In scope: `apps/cloudflare/src/hosted-email/routes.ts`, `packages/assistant-engine/src/assistant/outbox/retry-policy.ts`, `packages/hosted-execution/src/outbox-payload.ts`, this plan, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope: unrelated dirty `apps/web/**` device-sync/Linq work, broader hosted-email/store refactors, retry-heuristic redesign, and any unrelated package/app fixes not required by this patch landing or its mandatory audit flow

## Constraints

- Technical constraints: treat the supplied patch as behavioral intent, preserve unrelated worktree edits, and keep the change scoped to the downloaded artifact plus any audit-required tests/proof.
- Product/process constraints: follow the standard repo change workflow, run truthful scoped verification, complete the required audit passes, and finish via `scripts/finish-task` while this plan is active.

## Risks and mitigations

1. Risk: the patch may have drifted relative to current source ownership or existing refactors.
   Mitigation: validate with `git apply --check`, inspect the touched files before editing, and adapt only where current code shape requires a no-behavior-change translation.
2. Risk: cross-owner verification may surface unrelated pre-existing failures in the broader workspace.
   Mitigation: prefer truthful scoped verification first and record any unrelated blockers separately with the exact failing command and target.

## Tasks

1. Register the active lane in the coordination ledger and confirm the downloaded patch still applies cleanly.
2. Land the three supplied simplifications narrowly.
3. Run required scoped verification for the touched owners, then complete the required `coverage-write` and `task-finish-review` audit passes with any needed reruns.
4. Send the required same-thread file-attached review request and arm the depth-0 wake command.
5. Finish with a scoped commit via `scripts/finish-task`.

## Decisions

- Use a dedicated active plan even though the patch is narrow because the workflow also requires audit passes, a same-thread follow-up review send, and arming a recursive wake hop in the same turn.
- Start from the supplied patch intent rather than re-deriving refactors locally because the current source still accepts the artifact cleanly.
- Keep the landed code exactly aligned with the supplied patch because the required audits found no correctness or proof gaps worth widening.
- Treat the same-thread review send as unconfirmed because browser automation staged the draft and attachments but failed auto-submit with `send-button-disabled`; still arm the requested depth-0 wake hop so the watcher is ready if the thread receives the follow-up later.

## Verification

- Commands run:
  - `git apply --check output-packages/chatgpt-watch/review-gpt-ten-presets/bad-code/downloads/murph-code-quality-audit.patch`
  - `pnpm typecheck`
  - `pnpm test:diff apps/cloudflare packages/assistant-engine packages/hosted-execution`
  - `pnpm test:smoke`
  - `git diff --check`
  - required `coverage-write` audit on `gpt-5.4-mini` (no edits)
  - required `task-finish-review` audit (no findings)
  - `pnpm review:gpt --send --chat-url 'https://chatgpt.com/c/69dc20fe-9540-83a1-b07c-14c03724401c' --prompt 'Check my changes around the target area addressed in this thread for bugs/issues before production. Then review the same area thoroughly for architecture simplification. We are greenfield and want the simplest best long-term architecture. Return a .patch or .diff attachment with your changes. Keep the patch scoped to this target area, include any needed tests, and note assumptions briefly.'`
  - `pnpm exec cobuild-review-gpt thread wake --detach --delay 0s --chat-url 'https://chatgpt.com/c/69dc20fe-9540-83a1-b07c-14c03724401c' --session-id "$CODEX_THREAD_ID" --recursive-depth 0 --poll-interval 60000ms --poll-jitter 60000ms --poll-timeout 7200000ms`
- Outcomes:
  - `git apply --check` passed and the patch landed cleanly in the three targeted production files.
  - `pnpm test:diff apps/cloudflare packages/assistant-engine packages/hosted-execution` passed.
  - `pnpm test:smoke` passed.
  - `git diff --check` passed.
  - `pnpm typecheck` failed for an unrelated pre-existing dirty-file issue in `apps/web/test/hosted-onboarding-webhook-receipt-codec.test.ts` (`DbNull` type mismatch), outside this patch slice.
  - The `coverage-write` audit found existing proof already sufficient in the directly related tests and made no changes.
  - The final review audit returned no findings.
  - The same-thread review draft was staged with attachments but auto-submit failed with `send-button-disabled`; a fresh thread export still showed no new user turn, so delivery is unconfirmed.
  - The requested depth-0 wake hop is armed under `output-packages/chatgpt-watch/69dc20fe-9540-83a1-b07c-14c03724401c-2026-04-13T004356Z/` with status `waiting`.
Completed: 2026-04-13
