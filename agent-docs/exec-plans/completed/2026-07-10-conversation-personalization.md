Goal (incl. success criteria):
- Let a hosted member read and update Murph's saved tone, voice, and Terra/Sol preference in a normal supported conversation.
- Route web and conversation adapters through the same hosted-member preference owners; do not add vault-only preference state or a second model policy.
- Success means the assistant receives typed effective values and change status, tone/voice still converge through the existing mailbox event into canonical vault preferences, Sol remains billing-gated, and browser Settings remains only a fallback when the typed tool is unavailable.

Constraints/Assumptions:
- Preserve hosted-member authentication and member binding at the web-owned callback boundary.
- Require the active runtime write fence before Cloudflare forwards or signs a personalization callback; never accept a child-supplied target identity.
- Preserve the existing hosted-member capture -> `member.preferences.updated` mailbox event -> canonical vault convergence path for tone and voice.
- Preserve the nullable web-owned model preference and existing Sol eligibility/current-run semantics.
- Use the existing narrow dynamic-tool/web-callback pattern; no generic capability registry, new persisted state, or speculative cold-resume workaround.
- Preserve unrelated worktree and coordination-ledger edits.

Key decisions:
- Add one focused personalization operation rather than separate style and model tools.
- Reuse existing hosted preference mutation functions from both API routes and the internal assistant callback.
- Return the effective saved snapshot after mutation so the assistant can give durable confirmation.
- Keep the existing Settings link as an explicit capability-unavailable fallback.
- Forward personalization through the existing validated write-fence header path and sign only the fence-bound member.

State:
- Implementation, accepted security/prompt-review follow-ups, coverage-write audit, and scoped verification are complete. The uncommitted worktree is ready for the final scoped commit, rebase, PR, ReviewGPT, and CI loop.

Done:
- Reviewed the conversation-first invariant, current web style/model routes, assistant dynamic-tool pattern, and hosted preference ownership docs.
- Added the strict hosted-execution read/update contract with truthful saved, unchanged, and safely rejected effective results.
- Added the signed member-bound web callback that reuses the existing model/style owners in one transaction and preserves the style mailbox convergence path.
- Wired the dedicated Cloudflare port and allowlist through assistant runtime context into a capability-gated `murph.personalization` dynamic tool.
- Updated stable prompt behavior so Settings is fallback-only, no-ops are not described as new saves, Sol rejection is inferred only from its typed safe reason, and model changes are described as next-invocation changes.
- Added focused contract, owner atomicity/no-op/rejection, signed route, Cloudflare port/allowlist, runtime context, dynamic-tool, and prompt coverage.
- Updated the architecture, security, tone/voice, and assistant-model durable contracts.
- Focused verification passed: 5 hosted-execution contract tests; 61 assistant-engine tool/prompt tests; 214 assistant-runtime workspace-phase tests; 291 Cloudflare port/allowlist tests; and 7 web owner/route tests. The first web attempt only lacked a generated Prisma client in the fresh worktree; generation succeeded and the unchanged command passed on rerun.
- Affected-package typechecks passed for hosted-execution, assistant-engine, assistant-runtime, Cloudflare, and web after building the local operator-config artifacts required by the fresh worktree.
- `git diff --check` passed.
- Classified `assistant_personalization_tool` as a runtime write-fenced web-control mutation. Missing headers, stale attempts, wrong generations, and cross-member fences now fail before fetch; a valid active fence forwards its validated headers and replaces child-supplied identity/signature headers with a signature bound only to the fence member.
- Security follow-up verification passed: Cloudflare typecheck; focused runner-outbound suite with 181 tests; and `git diff --check`.
- Prompt-review follow-up made the tool schema a strict discriminated read/update `oneOf`, generated the complete voice label mapping from `assistantVoiceOptions`, mapped Terra/Sol through their canonical model constants, projected non-null `formal`/`upbeat` defaults without persisting them, and narrowed Settings fallbacks by field.
- Prompt re-audit found no remaining actionable issue after clarifying effective-versus-saved values, next-invocation model timing, same-turn style limits, and atomic compound Sol rejection.
- The required coverage-write audit added only two narrow proofs: style-only updates still read the canonical model owner and emit the existing mailbox wake, and execution-context normalization preserves/binds the hosted personalization port. Its focused web and engine suites passed (7 and 9 tests respectively), along with both affected typechecks.
- The prepared full CLI lane passed 114 files and 1,047 tests after one prepared-runtime rebuild eliminated an unrelated orphaned artifact-repair lock. The broader diff lane had already passed all selected guards and typechecks plus assistant-runtime (1,529 passed, 2 skipped), assistant-engine (2,035 passed, 4 skipped), hosted-local-harness (382 passed, 1 skipped), and setup-cli (124 passed) before the affected CLI workers timed out on that lock; the feature-focused web, Cloudflare, and hosted-execution suites are recorded above.
- Updated the durable-doc index for the now-implemented conversation-control contract; docs drift, final diff checks, and identifier/privacy scan passed.

Now:
- Create the scoped commit with `scripts/finish-task`, rebase onto current `origin/main`, and rerun conflict-affected checks if needed.

Next:
- Push the branch, open its separate draft PR, then run ReviewGPT and required CI to zero accepted findings and green checks.

Open questions (UNCONFIRMED if needed):
- Cold Codex `thread/resume` retains the known upstream dynamic-tool limitation documented by the assistant engine; this change adds no speculative workaround. Availability is proved at runtime-context and dynamic-tool contract boundaries.

Working set (files/ids/commands):
- apps/web/app/api/settings/assistant-style/route.ts
- apps/web/app/api/settings/assistant-model/route.ts
- apps/web/app/api/internal/**
- apps/web/src/lib/hosted-onboarding/member-preferences.ts
- apps/web/src/lib/hosted-onboarding/assistant-model-preference.ts
- packages/hosted-execution/src/**
- packages/assistant-engine/src/assistant/hosted-tool-context.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-runtime/src/hosted-runtime.ts
- focused tests under apps/web/test, packages/hosted-execution/test, packages/assistant-engine/test, and packages/assistant-runtime/test
- agent-docs/product-specs/murph-tone-and-voice.md
- ARCHITECTURE.md
- agent-docs/SECURITY.md
- apps/cloudflare/src/runner-outbound/web-control.ts
- apps/cloudflare/test/runner-outbound.test.ts
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
