Goal (incl. success criteria):
- Validate a lower native hosted Codex tool-output token limit against an isolated full-vault snapshot without exposing private vault contents.
- Exercise the complete `vault-cli` command surface as far as local prerequisites safely allow, including representative read and mutation paths, and prove truncated output remains recoverable through narrower follow-up reads.
- If the evidence is clean, lower the hosted limit at the existing Codex config owner with focused tests, direct scenario proof, required verification, audits, commit, and PR.

Constraints/Assumptions:
- Never print, commit, or persist private vault contents, identifiers, archive paths, credentials, or command arguments derived from private records.
- Extract and mutate only disposable copies outside the repository. Never run destructive or provider-write commands against the supplied archive or a canonical live vault.
- External-provider, credentialed, daemon-lifecycle, delivery, and interactive commands may receive contract/help validation instead of live side effects when their required authority is absent.
- Prefer the existing native Codex `tool_output_token_limit` setting; do not wrap individual shell commands or add a second truncation layer.

Key decisions:
- Treat correctness under truncation as more than exit status: outputs must retain an explicit truncation signal and support targeted recovery of omitted facts.
- Keep private evidence ephemeral and report only aggregate counts, sizes, statuses, and secret-safe command labels.
- Use a 4,000-token native Codex limit. A 2,000-token limit clipped a valid 2,903-token write confirmation, while 4,000 preserved every tested help, exact-record read, and representative write confirmation.

State:
- Complete; ready for the pushed-head PR review gate.

Done:
- Classified the change as hosted-runtime/deploy-surface work and created an isolated task worktree from current `origin/main`.
- Read the repo workflow, verification, security, reliability, testing, and completion-audit guidance.
- Validated the archive structure and extracted it only into an ephemeral, privacy-minimized audit workspace; the source vault digest remained unchanged after all tests.
- Built the current CLI and validated all 327 leaf commands through both `--help` and JSON `--schema`; all help stayed below 1,700 estimated tokens.
- Executed 107 safe read/discovery paths against the isolated snapshot: 102 succeeded, 34 exceeded 2,000 tokens, and 19 exceeded 4,000 tokens.
- Proved all 34 oversized results expose working native token windows and distinct continuation offsets. Proved eight oversized list families recover an omitted final record through a matching exact `show`, with every exact read below 1,100 tokens.
- Exercised 15 representative local write paths on a disposable copy. All completed after supplying their documented required fields; ordinary responses stayed below 4,000 tokens.
- Confirmed pinned Codex 0.144.0 accepts `tool_output_token_limit`, applies it to the model truncation policy, and clamps model-requested unified-exec output to that policy.
- Added the 4,000-token native hosted setting and focused config assertions; the focused hosted config suite passes (40 passed, 2 skipped).
- Completed the required coverage-write audit with no findings or test churn; the config-emission boundary is fully covered.
- Passed routed diff verification: assistant-runtime typecheck, all guards, 1,732 package tests (2 skipped), and 1,842 Cloudflare tests.

Now:
- Archive this execution plan and create the scoped commit.

Next:
- Push the exact verified head, start ReviewGPT concurrently with CI, resolve any findings, and report the rollout recommendation and telemetry limitation.

Open questions (CONFIRMED limitation):
- Hosted turn profiles retain privacy-safe raw tool-output character counts and request/tool counts, but do not directly record the final model-visible post-truncation token count or a native truncation flag. That is not required to enforce the 4,000-token canary, but explicit truncation incidence is the essential follow-up telemetry before considering 2,000 tokens.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- disposable private-vault audit workspace outside the repository
Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
