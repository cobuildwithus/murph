# Refresh assistant and completion-audit prompts for GPT-5.6

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Adapt Murph's production assistant prompt and completion-audit prompts to current GPT-5.6 guidance while preserving Murph's product, safety, privacy, deliverability, and tool-authority invariants.

## Success criteria

- Official GPT-5.6 prompt and migration guidance is inventoried and applied only where it changes prompt behavior.
- The production prompt removes targeted duplication, leads with outcomes and complete results, retains explicit authorization and stopping conditions, and avoids obsolete GPT-5.5 scaffolding.
- Completion-audit prompts, especially prompt and frontend review, evaluate GPT-5.6-era failure modes consistently without broadening their ownership.
- Focused prompt regressions, typecheck, and the required prompt-review audit pass succeed.
- Claude Code/Fable (`cc`) independently cross-checks the final diff and every accepted finding is resolved.

## Scope

- In scope: production system/developer prompt assembly, repo-owned completion-audit prompts and their workflow routing, prompt-content regression tests, and directly necessary docs.
- Out of scope: production-assistant model-string migration, API/request-schema changes, new GPT-5.6 features such as Programmatic Tool Calling or persisted reasoning, runtime authority changes, and unrelated active work. Completion-audit worker model routing is in scope.

## Constraints

- Technical constraints: preserve stable cacheable prompt prefixes, existing tool contracts, prompt layering, and exact product/security invariants; prefer deletion and surgical edits over new abstractions.
- Product/process constraints: keep legal names, local usernames, home paths, secrets, and raw prompts out of committed/generated artifacts; preserve unrelated working-tree edits; avoid overlapping active symbols owned by the thread-context and connected-app worktree rows.

## Risks and mitigations

1. Risk: shortening the prompt drops a safety or product-critical invariant.
   Mitigation: map each retained/deleted instruction to repo invariants and existing regression tests, then run prompt-review and focused tests.
2. Risk: concurrent prompt work causes merge conflicts or lost behavior.
   Mitigation: inspect active worktrees/rows and avoid their owned symbols; report unavoidable overlap rather than overwriting it.
3. Risk: GPT-5.6 guidance encourages a broad rewrite that obscures causality.
   Mitigation: make the smallest evidence-backed edits and keep optional model features out of this prompt-only pass.

## Tasks

1. Inventory official GPT-5.6 guidance and every production/audit prompt surface.
2. Reconcile independent sub-agent reviews into a minimal edit set.
3. Edit prompt surfaces and focused prompt regressions.
4. Run scoped verification, required prompt-review, and parent final review.
5. Run `cc` for an independent Claude Code/Fable cross-check and resolve verified findings.
6. Re-run checks and finish through the plan-aware commit path.

## Decisions

- Treat this as a prompt-primary current-checkout change; no production-assistant model/API migration is implied. Moving completion-audit workers to `gpt-5.6-sol` is the intentional model-routing exception.
- Use GPT-5.6 Sol guidance as the canonical prompt target named by the supplied official guide.
- Keep ReviewGPT on its currently supported configured model; its installed wrapper does not expose a verified GPT-5.6 Pro selection, and Pro is an API mode rather than a `gpt-5.6-pro` slug.
- Defer broad CLI-contract removal, capability-conditioned prompt assembly, skill-router compression, and action-policy consolidation to measured migration evals. Those changes cross active prompt owners and would obscure this surgical migration's causal signal.

## Verification

- Commands to run: focused assistant prompt tests, direct audit-prompt readback/search checks, `pnpm typecheck`, required `prompt-review`, `git diff --check`, and `cc` review.
- Expected outcomes: all checks green; no unresolved accepted prompt-review or Claude/Fable findings; no unrelated files included in the scoped commit.
- Final results: assistant prompt/skill tests passed (73/73), completion-workflow regression tests passed (26/26), full workspace typecheck passed, and `git diff --check` passed.
- Review results: the required GPT-5.6 prompt-review rerun and final Claude Code/Fable `cc` cross-check have no unresolved actionable findings. Accepted findings tightened PR-lane specialist routing, removed an unavailable commit-history requirement, restored notification formatting coverage, aligned the onboarding progress reference, and completed workflow regression assertions.

## Deferred eval-backed follow-ups

- Condition developer guidance on tools actually available to the turn, then measure capability-selection and cache effects.
- Replace the large always-injected CLI contract and verbose skill router with task-time discovery while preserving owner distinctions and command safety.
- Consolidate cross-tool action authority once, and move invocation mechanics shared with progress, browser, and connected-app tool schemas out of the developer prompt.
- Add explicit untrusted-data block boundaries and adversarial tests for vault, attachment, provider, email, and transcript content.
- Delete unused model-profile and prompt-cache metadata only in a separate structural change that can update planning call sites and tests without overlapping active work.
- Run the official migration matrix: GPT-5.5 baseline, GPT-5.6 with unchanged prompt and preserved effort, one lower effort, then this surgical prompt treatment. Track task success, completeness, tool behavior, latency, input tokens, and cost.
Completed: 2026-07-09
