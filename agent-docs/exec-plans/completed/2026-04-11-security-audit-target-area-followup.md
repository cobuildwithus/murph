# Goal (incl. success criteria):
- Land the watched-thread target-area patch only where it still applies in the shared loopback control-plane, assistant/device-sync listener binding, deletion-id normalization, and parser child-env seams.
- Success means non-loopback listener hosts are rejected through the shared owner seam, fallback deletion ids are deterministic across reorder-equivalent payloads, parser child env allowlisted keys are canonicalized safely, and the required scoped verification passes for the touched owners.

# Constraints/Assumptions:
- Treat the downloaded patch as behavioral intent; merge only the parts that are still missing in the current tree.
- Preserve unrelated dirty worktree edits already present in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `packages/assistant-engine/test/assistant-automation-state.test.ts`, `packages/cli/test/runner-vault-cli.test.ts`, and `packages/core/test/core.test.ts`.
- Keep the diff limited to the target packages already named in the active ledger row unless a direct compile or test fix forces a nearby adjustment.

# Key decisions:
- Recreate the missing active plan file so the existing in-progress ledger row has durable continuity again.
- Reuse the shared `@murphai/runtime-state` loopback helper from both daemons instead of duplicating host validation.
- Prefer deterministic hashed synthetic deletion ids over order-sensitive counters when provider payloads omit a stable resource id.
- Canonicalize preserved child-process env keys by uppercase allowlist key while keeping the first preserved variant when no canonical entry exists.

# State:
- ready_to_close

# Done:
- Read the required repo workflow, verification, completion, security, reliability, and testing docs.
- Inspected the exported watched-thread JSON and downloaded patch artifact.
- Compared the patch against the current tree and identified the still-missing changes in `runtime-state`, `assistantd`, `device-syncd`, `importers`, and `parsers`.
- Landed the still-applicable local delta in the current branch: deterministic importer deletion ids, parser env-key canonicalization tests, and the assistantd loopback-listener regression test.
- Ran the required verification and direct proof: `pnpm typecheck`, scoped `bash scripts/workspace-verify.sh test:diff ...`, `pnpm test:smoke`, and the direct `assertLoopbackListenerHost` scenario check.
- Ran the required completion audits, accepted one coverage-write importer regression-test expansion plus one tiny post-review parser precedence test, and re-ran the affected verification.
- Sent the required same-thread attached `pnpm review:gpt --send ...` follow-up; browser auto-send returned `commit-timeout` but recorded the new matching user-turn signature in the target thread.
- Armed the next recursive wake hop at depth 1, which wrote `output-packages/chatgpt-watch/69da4b72-eee4-8399-9a91-0f3411170f00-2026-04-11T141914Z/`.

# Now:
- Close this plan, commit the scoped remaining diff, and hand off the verification/audit status.

# Next:
- Wait for the next wake child to resume if the same-thread review returns another patch.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the managed-browser `commit-timeout` on the send step reflects a pure UI commit lag or a broader browser automation flake, though the captured matching user-turn signature strongly suggests the prompt was posted.

# Working set (files/ids/commands):
- Thread export: `output-packages/chatgpt-watch/69da4b72-eee4-8399-9a91-0f3411170f00-2026-04-11T132409Z/thread.json`
- Artifact: `output-packages/chatgpt-watch/69da4b72-eee4-8399-9a91-0f3411170f00-2026-04-11T132409Z/downloads/murph_targeted_bugfix.patch`
- Commands: `sed`, `rg`, scoped `pnpm` verification, `pnpm review:gpt --send`, `pnpm exec cobuild-review-gpt thread wake`
- Files: `packages/assistantd/test/http.test.ts`, `packages/importers/src/device-providers/{garmin.ts,oura.ts,whoop.ts}`, `packages/importers/test/device-providers/deletion-normalization.test.ts`, `packages/parsers/{src/shared.ts,test/shared.test.ts}`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
