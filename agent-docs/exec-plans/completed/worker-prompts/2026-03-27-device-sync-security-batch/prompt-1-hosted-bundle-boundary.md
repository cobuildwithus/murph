Murph security lane: patch the hosted execution bundle boundary so hosted `agent-state` no longer snapshots local-only vault runtime artifacts.

Ownership:
- Own `packages/runtime-state/src/{hosted-bundle.ts,hosted-bundles.ts}`.
- Own direct runtime-state coverage in `packages/runtime-state/test/hosted-bundle.test.ts`.
- Own direct contract/docs updates in `packages/runtime-state/README.md`, `apps/cloudflare/README.md`, and `packages/device-syncd/README.md` if needed to keep the trust-boundary story truthful.
- You may touch `apps/cloudflare/src/node-runner.ts` and `apps/cloudflare/test/node-runner.test.ts` only if the runtime-bundle change requires a narrow companion update or proof.
- This lane overlaps active work on `apps/cloudflare/src/node-runner.ts`. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow for this lane:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Implement the fix, add or adjust direct coverage, run the narrowest truthful verification for your owned surface, and report any remaining gaps.
- The parent lane will run the final repo-level audit passes and commit after collecting worker results.

Issue:
- `packages/runtime-state/src/hosted-bundles.ts` currently snapshots the entire vault `.runtime` tree into hosted `agent-state` via `snapshotHostedExecutionContext()` and `AGENT_STATE_VAULT_RUNTIME_ROOT`.
- The archive helper in `packages/runtime-state/src/hosted-bundle.ts` recursively collects every file unless explicitly filtered.
- That means hosted `agent-state` blobs can currently contain local-only runtime artifacts such as:
  - `.runtime/device-syncd/control-token`
  - `.runtime/device-syncd.sqlite`
  - `.runtime/device-syncd/stdout.log`
  - `.runtime/device-syncd/stderr.log`
  - `.runtime/search.sqlite`
  - `.runtime/inboxd.sqlite`
  - `.runtime/inboxd/*.json`
  - `.runtime/parsers/**`
- `packages/runtime-state/README.md` says runtime state is always local and rebuildable, but `apps/cloudflare/README.md` currently claims hosted `agent-state` includes hosted `.runtime/**`, and `apps/cloudflare/src/node-runner.ts` snapshots/persists those bundles on commit/finalize.

Best concrete fix:
- Do not keep bundling the whole vault `.runtime` directory.
- Prefer either:
  - a dedicated hosted-safe runtime subtree/root, bundled explicitly, or
  - a narrow allowlist on the `.runtime` root that includes only hosted-safe files
- At minimum exclude:
  - `.runtime/device-syncd/**`
  - `.runtime/device-syncd.sqlite`
  - `.runtime/search.sqlite`
  - `.runtime/inboxd.sqlite`
  - `.runtime/inboxd/**`
  - `.runtime/parsers/**`
  - any other obvious local-only control/log/cache artifacts you find
- Keep only the minimal hosted state that is actually required, and make that allowlist explicit.
- Update docs so the runtime-state contract and hosted-runner contract agree.

Tests to anchor:
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `apps/cloudflare/test/node-runner.test.ts` only if needed for direct proof

Specific regression proof requested:
- change `packages/runtime-state/test/hosted-bundle.test.ts` so it asserts local runtime artifacts are not restored from `agentStateBundle`
- add regression coverage proving these are excluded:
  - `.runtime/device-syncd/control-token`
  - `.runtime/device-syncd.sqlite`
  - `.runtime/device-syncd/stdout.log`
  - `.runtime/device-syncd/stderr.log`
  - `.runtime/search.sqlite`
  - `.runtime/inboxd.sqlite`
- preserve whatever minimal hosted state is required, and add explicit allowlist tests for it

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
