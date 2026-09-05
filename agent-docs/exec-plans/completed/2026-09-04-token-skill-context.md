# Load experiment support policy only when needed

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal and scope

Reduce policy loaded for routine experiment logging while preserving existing safety, setup, support consent, and canonical effects. Move only experiment first-session/support mechanics to a bundled reference. Behavior-followthrough remains unchanged; protocol resolution, run creation, and active logging remain in the experiment entrypoint.

## Success criteria

- Every original experiment policy line retained verbatim across entrypoint and reference.
- Safety, run setup, group privacy, occurrence identity, no-double-write rules, and stop gates remain inline.
- Support reference loads before support questions or effects; missing policy blocks dependent effects.
- Deterministic asset/policy tests, typecheck, and pinned real support/logging journeys pass.

## Product UX

- Effort: Patch.
- Outcome: Same exact reminder reconciliation and canonical repeated-set logging with less unrelated support policy during routine logging.
- Reaches: Private experiment support and logging; setup, clinical, consent, group privacy, and ambiguity gates are preserved.
- Proof: Exact support inventory/reconciliation, one event per confirmed occurrence, canonical totals readback, no private writes in group context, preserved whole-owner semantic assertions.

## Decisions and boundaries

- Keep the existing recursive asset packager and filesystem reads. No registry, eager input, schema, model, provider, state, or permission change.
- Narrowed the initial broader split after the grounded behavior setup journey missed the expected support offer. Restore all behavior guidance and experiment run-setup policy; do not weaken that journey's business assertions to claim success.
- The final conservative layout passes both support repair and canonical repeated-set logging. Keep the initial unnecessary-clarification sample in the evidence; successful live samples are not a guarantee of identical model behavior.
- Source-CLI fixture yielding exposed an existing loss of native running-command handles. Reuse the existing fixture friction report. Keep the test-only streamed-output reconstruction regression so initial surfaced policy is not lost from completed-event evidence.
- Private repeated-set fixtures use production CLI guidance; group fixtures retain their private-state boundary.

## Measurements

- Experiment entrypoint: 58,162 to 36,296 bytes, a 37.6 percent reduction.
- Every original nonempty experiment policy line retained across the two files.
- Full support still reads both files and may incur routing/read overhead; this is not a claim of overall token or allowance savings.
- Initial provider-visible inputs for individual and group chats are structurally unchanged: registry metadata, prompt assembly, eager/deferred tools, generated guidance, and history assembly are untouched. No measured-zero claim.

## Verification

- Earlier larger-layout policy/asset suite: 61 passed, 7 existing skipped. Earlier typechecks and complexity guard passed.
- Pinned Codex 0.151.0, GPT-5.6 Terra, local subscription: support reconciliation and repeated-set logging passed before final narrowing; grounded behavior setup remained Hold and its runtime changes were removed.
- Stream reconstruction regression passes: preserves initial policy, matches exact command identity and final tail, avoids duplication.
- Final conservative-layout policy/asset suite: 58 passed, 7 existing skipped. Stream-output regression, assistant-engine typecheck, complexity guard, line conservation, and changed-file privacy scan passed.
- Final conservative-layout support repair passed: entrypoint then full support reference, one exact compact inventory and one reconciliation; current reminder retained and stale review retired.
- Final logging sample held: it asked an unnecessary target clarification despite the canonical rotation. The unchanged-policy control passed with the identical production CLI fixture and unchanged business assertions; the final candidate rerun also passed. Both samples combined large skill reads and received truncated outer tool output, so the current evidence does not isolate a causal regression. No logging assertion was weakened.
- Parent inspected policy routing, whole-owner preservation, and test-only evidence handling. Final ReviewGPT is exempt under completion-workflow Final ReviewGPT Eligibility: prompt-primary relocation with no production code, authority, persistence, provider, protocol, or safety-policy change; direct journey proof remains required.
- Privacy scan clean on all ten files in the narrowed candidate; repeat on final plan/PR closeout.
- Skill Creator standalone validator lacked PyYAML; repository frontmatter, packaging/link, and semantic tests provide next-best validation.
- PR #2866 contains the final narrowed implementation. Parent candidate review and direct proof are complete. Close this plan, push the final docs-only commit, and mark Ready for exact-head CI. No merge or deployment is authorized by this task.

## Final handoff

- Final logging rerun passed without business-assertion changes: three eight-repetition writes to the member-local canonical target, no write to the stale reminder target, canonical progress and linked-session readback, 40 recorded repetitions across five completed sets, and no support-reference read. Parent inspected the final reply.
- Final runtime tree and focused proof reviewed; every original policy line remains present, with behavior-followthrough unchanged.
- Remaining external gate: CI on the final pushed commit. Update the PR evidence with its outcome; no further source work is required unless CI finds an issue.
Completed: 2026-09-04
