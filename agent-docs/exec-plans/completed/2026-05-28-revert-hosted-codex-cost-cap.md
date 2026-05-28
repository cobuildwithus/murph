Goal (incl. success criteria):
- Revert the hosted Codex cost-cap commit's compaction, resume-budget, image-redaction, and tool-output-limit behavior that is causing premature compaction and missing native resume.
- Preserve the browser-vault refresh runtime signaling behavior from that commit, including the minimal Temporal coalescing support that prevents duplicate pending refresh signals from resetting retry waits.
- Keep later independent runtime progress-tool work intact.

Constraints/Assumptions:
- Do not expose personal identifiers, raw messages, raw health data, secrets, full local paths, or prompt contents in docs, logs, commits, or final output.
- Keep the architecture simple: use Codex's normal resume/compaction path again instead of custom hosted resume-budget clearing.
- Preserve unrelated Murph Age active work and unrelated working-tree edits.

Key decisions:
- Use a reverse patch for commit `f4a18ae23d294ffa45373b2142e32353d068f377`, excluding browser-vault refresh and Temporal coalescing files.
- Preserve the completed cost-cap plan doc as an immutable historical snapshot; document this rollback with this separate plan.

State:
- Verification passed; ready for final review and commit.

Done:
- Identified the cost-cap commit as the source of `model_auto_compact_token_limit = 12000`, `tool_output_token_limit = 2000`, and the 32 KB rollout resume gate.
- Reverted the hosted Codex cost-cap, resume-budget, and image/native-routing truncation behavior.
- Preserved browser-vault refresh direct signaling and Temporal pending-signal coalescing.
- Ran `pnpm typecheck`.
- Ran `pnpm test:diff`.

Now:
- Final diff review, archive plan, and commit.

Next:
- Monitor hosted replies for normal native resume behavior and normal compaction threshold after restart.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `f4a18ae23d294ffa45373b2142e32353d068f377`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/src/inbox-*`
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
