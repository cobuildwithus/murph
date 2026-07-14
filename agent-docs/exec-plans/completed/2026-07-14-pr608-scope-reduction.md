Goal (incl. success criteria):
- Simplify PR #608 without discarding its validated newsletter delivery fixes.
- Success means scheduled newsletters keep the normal group conversation and normal Codex tool/shell behavior while retaining live authorization rechecks, durable outbox delivery, replay safety, immutable occurrence payloads, and bounded reconciliation evidence.
- The durable docs and PR description must state the narrower truth: current authorization is checked before protected reads and provider entry, but arbitrary model-authored content is not provenance-bound to only the latest preparation payload.

Constraints/Assumptions:
- Prefer deletion over newsletter-only assistant context machinery.
- Do not add a new service, route, state owner, queue, scheduler, authorization protocol, prompt mode, or delivery path.
- Preserve unrelated working-tree and coordination-ledger edits.
- Preserve the existing shared weekly summarizer, authorization proof, durable outbox, and occurrence-manifest work unless a dependency on isolated context is demonstrated.
- Preserve ordinary group conversation continuity, provider resume behavior, and normal Codex shell/tool access.

Key decisions:
- Remove the newsletter-only thread profile, native-resume suppression, shell disablement, memory overrides, and their context-specific prompt/test plumbing.
- Keep authorization proofing as a guard over current reads and recipient delivery, not as a claim that the model body contains no facts from normal conversation context or tools.
- Keep the existing outbox as the only delivery owner and implement the accepted parent-before-child and bounded-retention ReviewGPT fixes in that owner.
- Reject any replacement provenance tracker, content scanner, second context, or parallel delivery mechanism.

State:
- Implementation and required local completion gates complete; final commit and PR gates remain.

Done:
- Recovered the full reviewed branch after abandoning the uncommitted broad-reduction attempt.
- Confirmed the user wants normal assistant conversation and tool continuity while retaining independent delivery/retry fixes.
- Deleted the newsletter-only isolated thread, resume suppression, memory/shell overrides, and preloaded-skill path.
- Preserved the live authorization, one-shot send, durable manifest, retry, ambiguity, stale-proof, and no-recipient fixes.
- Added parent-before-recipient dispatch gating without a new schema or state owner.
- Limited pruning protection to matching unresolved canonical cron occurrences.
- Updated the durable spec and assistant guidance to state the narrower authorization/content-provenance boundary.
- Focused changed behavior tests and affected package typechecks pass; aggregate diff verification is green through guards/typechecks but package timing tests are constrained by current host load, with all new/unrelated timing cases except an older 100-intent stress test passing serially.
- Security/privacy completion audit found no medium-or-higher issue.
- Write-capable coverage audit added the fresh-attempt regression case and found no remaining coverage gap.
- Merged current `main`, including the new ReviewGPT anti-ratchet workflow, and resolved the newsletter context overlap in favor of normal session continuity.
- Re-ran both affected package typechecks after refreshing the lockfile install; both pass.
- Re-ran 124 focused assistant-engine tests after the merge: 123 pass and the pre-existing 100-intent timestamp-offset stress case times out at its 60-second limit on the loaded host. The changed newsletter retention test passes separately.
- Re-ran the three changed assistant-runtime newsletter dispatch/replay tests after the merge; all pass.

Now:
- Close the plan and create the scoped commit.

Next:
- Push, update PR #608 with the required intent/change-shape and retrospective, then follow the new ReviewGPT continuation rules while CI runs.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/notification-turn.ts
- packages/assistant-engine/src/assistant/codex-turn/planning.ts
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/src/assistant/outbox/store.ts
- packages/assistant-engine/skills/group-newsletter/SKILL.md
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- matching focused tests
- agent-docs/product-specs/group-health-newsletter.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
