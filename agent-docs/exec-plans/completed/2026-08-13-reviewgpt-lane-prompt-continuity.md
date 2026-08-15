# ReviewGPT lane and prompt continuity

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make ReviewGPT later rounds reuse the first round's browser lane deterministically and keep the completion-specialists prompt within a safe composer budget.

## Success criteria

- Later-round setup fails closed unless the browser lane is carried directly on the invocation; compatibility variables and local preferences cannot impersonate thread identity, while fresh conversations retain ordinary lane selection.
- Completion-specialists no longer duplicates the attached lens documents, and its fully assembled canonical and Frog prompts stay within an enforced 6,500-byte budget.
- Fresh-full recovery resets the context anchor to the current head, while the packager rejects a stale full-snapshot anchor.
- Focused shell-wrapper and preset tests cover the new contracts and the operations guide tells operators exactly what to retain between rounds.
- Shell syntax, focused tests, scoped typecheck, privacy scan, and final diff review pass; any unrelated root-check baseline failure is recorded.

## Scope

- In scope: `scripts/review-gpt.config.sh`, `scripts/review-gpt-pr-head-preflight.sh`, completion-specialists prompt assembly, focused CLI wrapper/packager tests, and ReviewGPT operations documentation.
- Out of scope: ReviewGPT browser internals, a persistent thread-to-lane registry, attachment lifecycle changes, and a separate composer-hydration manager for issue #1686.

## Constraints

- Technical constraints: preserve direct `REVIEW_GPT_BROWSER_LANE` authority for same-thread rounds, keep lane selection deterministic, and measure the complete preset-plus-custom-prompt payload before packaging or browser work.
- Product/process constraints: keep private runtime evidence out of tracked artifacts; implement from activation head `f3a2842f0314e646d4d3a9c054a3b062517d3ae3`; do not push or open a PR.

## Risks and mitigations

1. Risk: later-round callers omit the first-round lane and silently land in an inaccessible ChatGPT workspace.
   Mitigation: fail before packaging/browser launch with an actionable lane-continuity diagnostic.
2. Risk: prompt compaction removes specialist intent.
   Mitigation: retain the orchestration/output contract while treating attached canonical lens documents as the sole detailed lens definitions, backed by direct preset tests.
3. Risk: callers recreate the removed duplication through a large custom prompt.
   Mitigation: enforce one assembled-prompt budget for canonical and Frog callers, document the compact invocation contract, and diagnose a ready ZIP plus disabled Send as composer validation instead of adding hydration retries.
4. Risk: a recovery command carries a stale same-thread anchor into a new full-snapshot conversation.
   Mitigation: provide a distinct fresh-full command that pins the current head, and prove stale anchors fail closed in the packager harness.

## Tasks

1. Trace wrapper and preset assembly behavior from the activation base.
2. Implement later-round lane continuity and completion-specialists prompt compaction with a preset-size regression budget.
3. Add focused tests and update the ReviewGPT operations guide.
4. Run scoped verification, inspect/redact the diff, and close the plan through the scoped commit helper.
5. Apply deep-review follow-ups for direct lane provenance, fresh-full anchor recovery, and assembled canonical/Frog prompt sizing.

## Decisions

- Treat issue #1686 as the visible symptom of issue #1755's oversized completion-specialists prompt, not a separate browser lifecycle.
- Require explicit lane carry-forward for later rounds instead of adding a thread-to-profile registry.
- Capture the direct lane before sourcing local preferences; use only that captured value for same-thread rounds.
- Keep different-lane recovery on a fresh conversation with a full snapshot and current-head anchor.

## Verification

- Commands to run: `bash -n` on the wrapper scripts; focused CLI Vitest; `pnpm typecheck`; repository privacy scan; final `git diff` inspection.
- Expected outcomes: focused commands pass, later-round fixtures reject direct, compatibility, and local-config lane omissions before browser work; fresh-full current anchors pass while stale anchors fail; and canonical/Frog assembled prompts remain within the documented budget.
- Actual outcomes: shell syntax, the full 45-case CLI wrapper/packager file (44 passed, 1 intentional skip), CLI typecheck, assembled canonical/Frog prompt budget, privacy scan, and diff checks pass. Root `pnpm typecheck` completed its package checks but remained red on two pre-existing workspace-boundary imports outside this diff.
Completed: 2026-08-13
