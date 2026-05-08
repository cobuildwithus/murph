Goal (incl. success criteria):
- Decouple hosted Codex provider continuity from broad foreground workspace checkpointing by adding a tiny, background-oriented continuity artifact path.
- Success means foreground assistant runs can schedule a best-effort Codex continuity capture that reads only assistant session resume requirements plus referenced Codex rollout files, without scanning vault/raw/derived workspace state or writing a portable workspace manifest.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active hosted-execution rows.
- Do not reintroduce foreground full, working, or broad workspace checkpoint writes.
- Full/base idle checkpoints may continue to include/supersede Codex continuity.
- The tiny path is best-effort and must not block foreground response completion.

Key decisions:
- Implement the tiny collector in `packages/runtime-state` next to existing Codex continuity validation so restore/manifest invariants are reused.
- Expose it to hosted runtime through an optional platform hook rather than routing it through the existing workspace checkpoint request builder.

State:
- Handoff; implementation complete, scoped commit blocked by overlapping dirty hosted-runtime files.

Done:
- Added `snapshotHostedCodexContinuityArtifact`, which writes only manifest-referenced hosted Codex rollout files plus the continuity manifest and never builds a portable workspace manifest.
- Added focused runtime-state restore/exclusion tests for the tiny artifact path.
- Added optional hosted runtime `codexContinuityPort` scheduling after foreground assistant progress, without invoking the workspace checkpoint request builder.
- Wired the Cloudflare runtime platform port to persist the tiny artifact through the artifact store when a workspace lease is available.
- Updated hosted runtime protocol/runtime-state docs to describe tiny continuity separately from idle full/base checkpoints.
- Verification passed: focused runtime-state tests, focused assistant-runtime entrypoint tests, focused Cloudflare runtime-platform tests, focused package typechecks, repo typecheck, and diff whitespace check.

Now:
- Handoff.

Next:
- Commit in a clean/scopable worktree once overlapping dirty hosted-runtime and ledger edits are reconciled.

Open questions (UNCONFIRMED if needed):
- Whether Cloudflare should persist the tiny artifact ref into the web-owned workspace pointer in a later compatibility change; this plan keeps it as a best-effort background artifact only.
- UNCONFIRMED: broader Cloudflare node suite currently has unrelated browser-vault alarm failures in this dirty checkout.

Working set (files/ids/commands):
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/runtime-state/README.md`
- `agent-docs/references/hosted-runtime-protocol.md`
