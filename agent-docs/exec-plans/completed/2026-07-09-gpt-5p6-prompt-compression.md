# Compress the GPT-5.6 assistant prompt without behavior regression

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Reduce Murph's always-on assistant prompt by moving domain workflow detail into owning skills, replacing the capability catalog with a compact offer policy, and compressing skill routing while preserving safety, authorization, tool accuracy, and product behavior.

## Success criteria

- The resident static kernel retains medical safety, privacy, authorization, canonical-state, tool-truthfulness, completion, and product-style invariants.
- PR #480's understand-before-recommending contract remains explicit: data-first grounding, bounded one-question discovery across turns, motivation capture, canonical persistence, recommendation follow-through, direct-answer exceptions, and nothing-to-fix as a valid result.
- Skill routing keeps explicit distinctions for overlapping owners and critical composite routes without retaining 36 verbose trigger mini-prompts.
- Capability offers remain contextual, available-route-aware, bounded to one useful next step, and governed by the existing consent boundaries.
- Domain mechanics removed from the resident prompt are present in the smallest owning skill set rather than duplicated.
- The full CLI contract and runtime request path remain unchanged; no reply-path `vault-cli --llms` discovery is introduced.
- Focused prompt/routing regressions, measured token budgets, typecheck, required prompt review, and the requested Claude Code/Fable `cc` review pass with no unresolved actionable findings.

## Scope

- In scope: `packages/assistant-engine` system prompt text, package-owned skills, prompt-content and routing/token regression tests, and directly necessary prompt-audit proof.
- Out of scope: CLI-contract rendering or discovery, model strings, reasoning settings, API/request schemas, native tool schemas, runtime authority, persisted state, frontend behavior, and optional GPT-5.6 features.

## Constraints

- Preserve the stable prompt prefix and existing prompt layering.
- Move instructions rather than duplicate them; keep global invariants resident and domain mechanics with their owner.
- Preserve exact CLI/tool contracts and avoid adding task-time discovery latency to common reply paths.
- Preserve unrelated working-tree work and coordinate around active system-prompt rows in separate worktrees.
- Keep private identifiers, local paths, secrets, and raw user content out of committed artifacts and review packets.

## Risks and mitigations

1. Risk: compressed routing selects the wrong overlapping skill.
   Mitigation: retain a compact overlap matrix and add representative pairwise routing assertions/evals.
2. Risk: moving a rule into a skill makes a safety or authorization invariant conditional.
   Mitigation: classify every moved rule; keep true cross-route invariants resident and verify each destination skill before deleting source text.
3. Risk: compression regresses the differentiated context-first behavior introduced by PR #480.
   Mitigation: preserve each behavior explicitly in the core and add focused prompt assertions for the full contract rather than testing only the section heading.
4. Risk: a shorter capability policy reduces useful feature discovery or broadens consent.
   Mitigation: keep one-offer and consent rules resident, place capability-specific eligibility with the owning skill/tool, and test positive and negative cases.
5. Risk: a broad rewrite obscures the source of regressions.
   Mitigation: change the four approved seams only, leave CLI/runtime/tool schemas untouched, measure each rendered section, and resolve independent review findings before commit.

## Tasks

1. Inventory current resident sections, matching skills, prompt tests, and token measurement tooling.
2. Implement the compact static kernel, skill router, capability-offer policy, and task-time protocol discovery.
3. Move deleted domain mechanics into the smallest owning skills and update focused regressions/token budgets.
4. Run focused tests, token measurements, typecheck, and Claude Code/Fable `cc`; resolve verified findings.
5. Run the required GPT-5.6 prompt-review audit, parent final review, and plan-aware commit.

## Verification

- Commands to run: focused assistant-engine prompt and skill tests; token measurement for the assembled full route and changed resident sections; `pnpm test:diff` or package coverage as routed; `pnpm typecheck`; `git diff --check`; requested `cc` review; required `prompt-review` audit.
- Expected outcome: behavior assertions and checks pass, measured prompt size decreases materially, CLI contract content is unchanged, and no accepted review finding remains unresolved.

### Evidence recorded during implementation

- Exact `o200k_base` measurement for the same production-style Telegram route before and after compression: 30,353 -> 20,791 tokens, a reduction of 9,562 tokens (31.5%). The final measured prompt is 102,332 characters; the static core is 1,408 tokens, the stable route layer is 18,486 tokens, the thread layer is 883 tokens, and the dynamic layer is 14 tokens.
- The prebuilt CLI contract remains byte-for-byte unchanged at 32,143 characters / 6,753 tokens and is covered by a tail-passthrough sentinel regression. No reply-path CLI discovery call was added.
- The eight focused prompt/skill suites pass (117 tests), the final model-behavior rerun passes (54 tests), and all nine edited-skill validators pass. Root typecheck passed during the implementation pass, and the final assistant-engine typecheck passes after the last prompt wording change.
- The first Claude Code/Fable review found four non-blocking behavior seams. All four were accepted and corrected: latent capability discovery, the shared one-offer budget, recommendation follow-through as the default, and current-plan routing to `behavior-followthrough`. The requested Fable rerun returned `NO FINDINGS`.
- The required GPT-5.6 prompt review found two additional preservation seams: the PR #480 user-facing `experiment` wording and global reachability of the shared named-movement catalog workflow. Both were corrected, and a fresh prompt-review rerun against all three live official sources returned no evidence-backed findings.
- No no-cost live behavioral harness exists for this prompt stack, and the shell lacks both the provider credential and patched Terra model catalog needed for a faithful live trace. The review matrix and deterministic regressions cover the migration locally; representative Terra traces remain a rollout evaluation rather than fabricated local proof.
- Final `pnpm test:diff` completed the changed owner successfully: assistant-engine passed 1,995 tests with four skips, and its affected dependents also passed until the CLI reverse-dependent lane. That lane reported six load-sensitive timeouts and one stale release-script assertion in files untouched by this task; the two initially timed-out assistant-engine outbox cases passed in isolation. The prompt-only diff neither changes the CLI/runtime paths nor the concurrently edited verification scripts responsible for that pre-existing assertion.
Completed: 2026-07-09
