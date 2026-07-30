# Route bounded hosted subagent work from Sol to Terra

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let hosted Sol roots explicitly route well-specified, low-consequence leaf
  work to Terra at low reasoning without giving children inherited conversation
  history, while keeping judgment, permissions, and final synthesis at the root.

## Success criteria

- The pinned Codex 0.145.0 config exposes per-spawn model and reasoning
  overrides through the existing MultiAgent V2 table.
- Hosted guidance names the bounded Terra leaf-work contract and requires a
  self-contained child message when `fork_turns="none"`.
- MultiAgent V2 usage resolves each participating child thread's effective
  model before pricing, so a Terra override cannot be billed as inherited Sol.
- The production hosted config and Cloudflare live-model smoke config retain
  the same table shape.
- Focused assistant-runtime and Cloudflare tests pass, exact-head CI is green,
  required ReviewGPT stages have no accepted findings, and the PR lands on
  `main`.

## Scope

- In scope: hosted Codex configuration and exact assertions, the Cloudflare
  container shell-smoke configuration and regression assertion, and existing
  Codex subagent usage attribution plus focused unit and pinned-app-server
  integration proof.
- Out of scope: changing the root model preference owner, adding a scheduler or
  delegation state owner, changing child concurrency, changing user-facing
  behavior, or upgrading Codex.

## Constraints

- Technical constraints: keep the existing package entrypoints and one-way
  workspace dependency graph; target the repository-pinned Codex 0.145.0
  feature contract; keep detached children bounded one-shot leaves.
- Product/process constraints: preserve reply-critical work in the root,
  maintain permission-sensitive judgment at the root, use focused local proof
  plus exact-head CI, and follow the preliminary specialist and final
  cross-cutting review gates.

## Risks and mitigations

1. Risk: a scalar feature flag replaces the MultiAgent V2 table and drops the
   override exposure or existing hints.
   Mitigation: render the production and smoke configs as tables and assert the
   scalar form is absent.
2. Risk: a low-cost child lacks enough context or receives work that requires
   judgment.
   Mitigation: require every input, path, constraint, and completion criterion
   in the child message and reserve ambiguous, clinical, permission-sensitive,
   and synthesis work for the root.
3. Risk: prompt growth is disproportionate or undocumented.
   Mitigation: capture complete representative initial provider input at base
   and head with identical model/tool modes and report token and byte deltas.
4. Risk: MultiAgent V2 activity names the child thread but omits the effective
   model, causing explicit Terra usage to inherit Sol pricing.
   Mitigation: resolve the effective model from the existing local app-server
   `thread/resume` response for each evidenced child, retain raw spawn metadata
   as a fallback, and prove the complete Sol-to-Terra flow through the pinned
   app server.

## Tasks

1. Confirm the supplied patch's behavioral intent against the current source,
   pinned Codex documentation, and owner contracts.
2. Adapt the current config surfaces and preserve their existing table owner.
3. Run focused unit/config proof plus a direct pinned-Codex config parse check.
4. Measure representative base/head provider input impact.
5. Commit and push the exact candidate, open the PR, and run the preliminary
   prompt and coverage specialist lenses.
6. Resolve findings, complete parent final review and verification, close this
   plan with the final scoped commit, then run final ReviewGPT with CI.
7. Prove mergeability, merge the PR to `main`, confirm the landed commit, and
   retire the clean task worktree.

## Decisions

- Use the existing `@murphai/hosted-execution/assistant-model` public entrypoint
  for canonical Sol and Terra identifiers.
- Keep the current MultiAgent V2 table rather than migrating to the newer
  stable `[agents]` surface because the shipped runtime is pinned to Codex
  0.145.0, whose release added the exact spawn override exposure this patch
  uses.
- Keep collaboration on its pinned default typed-tool surface. Resolve the
  child's effective model through the app server instead of inferring it from
  the parent or parsing code-mode JavaScript.
- Narrow Terra-low examples to read-only, deterministic work; structured
  health-data extraction remains at the root without dedicated evaluation.

## Verification

- Passed: assistant-runtime focused Vitest (42 passed, 2 skipped) and
  Cloudflare container-entrypoint focused Vitest (50 passed).
- Passed: `@murphai/assistant-runtime` and `@murphai/cloudflare` typechecks.
- Passed: pinned Codex 0.145.0 accepted
  `features.multi_agent_v2.expose_spawn_agent_model_overrides=true` and kept
  MultiAgent V2 enabled.
- Passed: pinned Codex 0.145.0 scripted app-server proof spawned a Terra child
  from a Sol parent and emitted a Terra-attributed additional-usage draft
  without retaining the child prompt.
- Passed: `@murphai/assistant-engine` typecheck and focused subagent usage tests.
- Passed: hosted usage-allowance regression suite (104 tests), confirming the
  existing Sol and Terra pricing owners consume the attributed model.
- Measured complete initial Responses request bodies under pinned Codex 0.145.0,
  `gpt-5.6-sol`, low reasoning, code mode, and representative real tool
  surfaces. After the preliminary prompt narrowing, direct input changes from
  118,164 bytes / 25,602 tokens to 118,857 bytes / 25,739 tokens (+693 bytes /
  +137 tokens). Group input changes from 100,092 bytes / 21,670 tokens to
  100,785 bytes / 21,820 tokens (+693 bytes / +150 tokens). Token counts use
  `gpt-tokenizer` 3.4.0 `o200k_base`; HTTP transport headers are excluded. The
  refresh applies the exact 20-byte / one-token reduction of the narrowed
  usage hint to the previously captured complete request bodies; the
  surrounding request and tool surfaces are unchanged.
- Preliminary `completion-specialists` completed with two accepted findings:
  narrow the health-data example and correct V2 child-model pricing. Both are
  addressed in the current candidate.
- Parent final review and post-rebase focused verification completed with no
  remaining local findings.
- Pending after this plan-closing commit: exact-head required CI, final
  `pr-review`, mergeability proof, merge confirmation, and worktree retirement.
Completed: 2026-07-30
