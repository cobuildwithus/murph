Goal (incl. success criteria):
- Diagnose and fix hosted iMessage reply latency without adding a new broad foreground persistence system.
- Success means an inbound iMessage-triggered hosted assistant turn shows quick typing/reply behavior on cold container start, warm container reuse, and warm multi-message state-mutating turns.
- Keep the hosted-runner minimal architecture migration guide invariants: foreground turns do not build/checkpoint workspace snapshots; browser-vault and tiny Codex continuity are background-only; idle shutdown is the only broad checkpoint producer.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active hosted-runtime rows.
- Do not expose local account names, home paths, message contents, provider payloads, mailbox ids, secrets, prompts, transcripts, vault contents, or raw logs in docs, tests, commits, or handoff.
- Use metadata/timing evidence from local runtime, DB, and Cloudflare surfaces where available; avoid printing sensitive payloads.
- Root-cause latency before changing architecture. If the fix requires a larger architecture decision or becomes unclear, use the Work With Pro path rather than landing a bandaid.
- Prefer deleting or bypassing foreground complexity over introducing new queues, journals, CAS gates, or path-scoped checkpoint machinery.

Key decisions:
- Treat the migration guide as the governing plan for this latency task.
- Foreground response latency is optimized ahead of dashboard freshness, Codex continuity completeness, and pre-idle crash persistence.
- Deterministic delivery identity is the acceptable duplicate-send mitigation for foreground no-checkpoint behavior, subject to provider support.

State:
- Investigation.

Done:
- Created the task goal.
- Read the repo routing docs, verification/security/reliability docs, hosted runtime protocol, and hosted-runner minimal architecture migration guide.
- Confirmed the worktree already contains overlapping hosted-runtime, Cloudflare, web, assistant-runtime, and assistant-engine edits; preserve them.

Now:
- Map the current inbound iMessage to hosted runner path and identify which awaited foreground work blocks typing or reply delivery.

Next:
- Gather timing evidence from local iMessage test sends and available DB/Cloudflare metadata.
- Add/adjust focused tests for no foreground checkpointing and quick foreground return.
- Implement the smallest root-cause fix that satisfies the migration-guide invariants.
- Run required verification and completion audits before scoped handoff/commit if safe.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: exact current production bottleneck after the existing dirty changes in this checkout.
- UNCONFIRMED: whether provider-side iMessage delivery supports true deterministic idempotency, or only local warm-container sent markers.

Working set (files/ids/commands):
- `hosted-runner-minimal-architecture-migration-guide.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-runner/**`
- `apps/web/src/lib/browser-vault/**`
- Focused hosted-runtime, hosted-local, Cloudflare runner, and web ingress tests as identified during investigation.
