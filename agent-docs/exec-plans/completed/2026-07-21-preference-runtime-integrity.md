Goal (incl. success criteria):
- Make onboarding persona, tone, and voice saves reliably reach the hosted member vault and every applicable private assistant turn.
- Preserve replay and rolling-deploy compatibility for previously valid persona mailbox events.
- Keep post-commit wake handoff bounded so a stalled Temporal call cannot hang onboarding or recovery.
- Never plan a fresh reply while an immediately due newer preference remains staged.

Constraints/Assumptions:
- Web remains the canonical projection and durable mailbox producer.
- The hosted vault remains the canonical runtime preference owner.
- Unknown persona IDs still fail closed; only the enumerated stored legacy IDs may normalize.
- Preserve personal/group preference isolation and product-critical reply availability.

Key decisions:
- Normalize legacy persona IDs only at the persisted/wire compatibility boundary.
- Reuse the existing abortable Temporal signaling seam; add no queue or state owner.
- Apply persona style to trusted scheduled private provider turns, while retaining maintenance/output-only exclusions.
- Yield and immediately re-enter when the bounded preference page still has due work.

State:
- Complete.

Done:
- Traced Web save through mailbox, Temporal, Cloudflare, container import, vault causal state, prompt planning, and voice resolution.
- Verified four edge cases with static and focused-test evidence.
- Landed legacy wire normalization, bounded wake handoff, scheduled private-turn styling, and due-backlog yielding.
- Passed focused Web, hosted-execution, Temporal, Cloudflare, assistant-runtime, assistant-engine, contracts, and core regression suites.
- Passed owner typechecks for Web, Cloudflare, hosted-execution, Temporal, assistant-runtime, assistant-engine, contracts, and core.
- Passed the full canonical acceptance suite.
- Completed the required Codex coverage audit; added proof that private persona defaults do not leak into group turns.
- Passed canonical acceptance again after the coverage-only test addition.

Now:
- None.

Next:
- After merge, deploy the Cloudflare Worker/runner bundle before Web and verify preference-event convergence.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/parsers.ts
- packages/hosted-execution/test/*
- apps/web/app/api/settings/assistant-style/route.ts
- apps/web/src/lib/hosted-orchestration/preference-handoff-sweeper.ts
- apps/web/test/settings-assistant-style-route.test.ts
- apps/web/test/hosted-preference-handoff-sweeper.test.ts
- apps/cloudflare/test/runtime-bridge-mailbox-payload-decode.test.ts
- packages/assistant-engine/src/assistant/codex-turn/planning.ts
- packages/assistant-engine/test/assistant-codex-turn-planning.test.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
Status: completed
Updated: 2026-07-21
Completed: 2026-07-21
