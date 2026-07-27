Goal (incl. success criteria):
- Resolve PR #987's clean-install Web typecheck failure and final ReviewGPT's mixed-trust recap-evidence finding without weakening managed-group automation boundaries.
- Success means Web resolves the new public hosted-execution leaf before build artifacts exist, recap composition reads only structured accepted text inputs from the exact group route, crafted delimiters and attachment evidence cannot forge attribution or enter the prompt, canonical verification and replacement CI pass, and final ReviewGPT accepts the exact head.

Constraints/Assumptions:
- Preserve the dedicated Temporal-safe leaf module and package public export.
- Do not add dependencies or change the lockfile.
- Keep the final ReviewGPT first-reviewed baseline at `9f56fa6c4d9d836dad47484cd69058b36c813813`.

Key decisions:
- Treat the CI failure as introduced: Web's explicit workspace source aliases omitted the new leaf and local `dist` state masked that omission.
- Add the one missing source alias; do not move the helper back into the Temporal workflow dependency closure.
- Stop parsing rendered transcript prompts for recap authority. Reuse the existing assistant input-event owner, admit only route-authorized text-only conversation events, and silently skip before lifecycle/model work when bounded structured evidence is unavailable.

State:
- Implementation and local verification complete; exact-head PR gates follow the scoped commit.

Done:
- Reproduced the exact CI diagnostic from the failed job log.
- Confirmed the package export exists and the Web TypeScript path inventory is the missing clean-install boundary.
- Added the missing source alias and passed focused Web typecheck plus the production Temporal build.
- Final ReviewGPT round 2 proved crafted message or extracted attachment text can forge the rendered-prompt delimiter parser; the Telegram activity correction remains accepted.
- Deleted rendered-prompt parsing and moved recap composition to the existing structured assistant input-event owner with exact-route, non-self, route-authorized, text-only admission.
- Excluded attachment descriptors, parsed attachment evidence, mismatched prompt-content mirrors, and non-text inputs; unavailable or over-cap evidence consumes the occurrence before lifecycle/model/outbox work.
- Added bounded occurrence-window input-store filters so the fail-closed scan cap applies to the current conversation window instead of lifetime runtime history.
- Added production-shaped delimiter, attachment, mismatched-mirror, route, audience, occurrence-boundary, and pre-provider skip regressions.
- Passed focused assistant-engine typecheck and 156 focused tests.
- Passed the fresh-bundle hosted-local Telegram scheduled-reminder scenario: both the 100-message Sunday superlatives group alarm and the personal reminder completed through their ordinary no-nudge paths.
- Ran the canonical diff dispatcher. All changed-owner and downstream suites passed; one unchanged hosted-local harness readiness test timed out under shared-host contention and then passed 2/2 immediately in isolation.
- Passed full conservative `pnpm verify:acceptance`, including package coverage, Web 6,749-test/lint/dev-smoke/production-build verification, Cloudflare 1,935 Node tests plus Workers tests, and 204 acceptance scenarios.

Now:
- Create the scoped completion commit and push the exact head.

Next:
- Run replacement exact-head CI and final ReviewGPT round 3, remediate any actionable findings, then merge and retire the worktree.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/tsconfig.json`
- `packages/assistant-engine/src/assistant/maintenance-evidence.ts`
- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/test/maintenance-evidence.test.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- current architecture, security, reliability, product-spec, and testing-map docs
- focused Web typecheck
- focused assistant-engine tests and typecheck
- `pnpm test:diff agent-docs apps/web packages/assistant-engine packages/hosted-execution packages/hosted-orchestrator-temporal`
- PR #987 exact-head CI and final ReviewGPT
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
