Goal (incl. success criteria):
- Remove the separate hosted Codex foreground continuity artifact path.
- Success means foreground assistant runs do not schedule Codex continuity uploads, no platform port exists for tiny continuity artifacts, and provider-native continuity remains inside normal hosted workspace snapshots.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active hosted-execution rows.
- Do not reintroduce foreground full, working, or broad workspace checkpoint writes.
- Full/base idle checkpoints continue to include provider continuity when live assistant session resume state requires it.
- Restore correctness must not depend on a separate tiny Codex continuity artifact.

Key decisions:
- Do not add a durable web-owned `codexContinuityRef`.
- Remove the optional hosted runtime continuity port instead of leaving a disabled branch.
- Keep full/base Codex continuity validation, manifest, and restore coverage.

State:
- Implementation in progress.

Done:
- Removed the foreground scheduler call and optional `codexContinuityPort` contract.
- Removed Cloudflare runtime-platform background tiny-artifact upload wiring.
- Removed the standalone `snapshotHostedCodexContinuityArtifact` API, budget error, and tiny artifact tests.
- Updated hosted runtime protocol and runtime-state docs to state that foreground execution does not publish separate Codex continuity artifacts.

Now:
- Run focused verification and completion audits.

Next:
- Archive this plan with the scoped commit if verification passes.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: broader Cloudflare node suite currently has unrelated browser-vault alarm failures in this dirty checkout.

Working set (files/ids/commands):
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `packages/runtime-state/README.md`
- `agent-docs/references/hosted-runtime-protocol.md`
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
