# Astra access on Edge and spiral galaxy artwork

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Allow active paid individual and Family Edge seats to select and run Astra, alongside Max. Arrange the blue animated stars into a loose spiral galaxy with cursor attraction.

## Scope and constraints

Reuse the current premium-access owner, settings/API, and runtime catalog authorization. Preserve Terra defaults, usage rates, OpenAI requirement, Pulse/trial denial, suspended or inactive seat denial, and existing group-room restrictions. No billing-rate changes or migration. Shipping through the existing merge and release gates is authorized; rollback still requires explicit permission.

## Tasks

1. Complete spiral rendering and responsive, hover, and reduced-motion proof.
2. Derive Astra access from existing Edge/Max eligibility; update rejection and upgrade copy, assistant tool guidance, and durable documentation.
3. Verify individual and Family eligibility, fallback/reactivation, preference writes, API/runtime authority, settings controls, and exact next-query assistant behavior.
4. Run focused tests, relevant typechecks, lint, complexity, parent review, then commit/push and refresh PR evidence.
5. Start required ReviewGPT on the final pushed head concurrently with CI; resolve findings and report remaining gates truthfully.

## Product UX

Product change. Edge and Family Edge can choose Astra and receive a next-query confirmation. Max retains access. Pulse/trial and inactive members remain excluded, with Edge as the minimum upgrade. Downgrading Max to Edge keeps Astra; dropping below Edge falls back to Terra while preserving the saved preference. Group rooms remain excluded. Walkthrough Ready: deterministic settings/API/runtime tests and the real-Codex Edge selection journey pass.

## Verification

Passed: settings/preferences/API/workspace proof (171 tests including the four Edge denial cases), assistant tool contracts (15 tests), Web and assistant-engine typechecks, scoped Web lint and complexity guard. Browser proof passes at 390px and 1280px: equal subtle pull across brightness layers, disabled-card hover without selection, reduced-motion still state, no hydration warnings, and correct attraction after a quarter rotation. The galaxy has 208 stars and rotates within a fixed tilted disk once every four minutes. Pointer physics use projected screen coordinates so the same small pull applies throughout the disk.

Real-Codex command: `pnpm test:assistant:live -- --test "saves Astra exactly once for the next Edge query"`, default `gpt-5.6-terra`, local subscription. The initial run duplicated the update. Main now includes the dynamic-tool return-text handling correction in the shared base instructions; the temporary local instruction was removed in favor of that owner. Final post-merge live verification passed with exactly one update and a truthful future-query confirmation; provider and reasoning stayed unchanged. Reply review: Ready.

Main reconciled at `4d75adb347` with the current main review policy preserved verbatim. Post-merge proof: 171 Web tests, 15 assistant contract tests, 36 runtime contract tests, Web/assistant-engine/assistant-runtime typechecks. All four required CI gates passed on `37905a29c81fe495b17550de2290c9e2413168f8`. ReviewGPT round 3 passed on that exact head with zero findings and zero accepted issues; the full snapshot used GPT-6 Pro on Eragon. Exact-turn capture, model identity, attachment scope, ancestry, completion marker, and a review duration above the trust floor were verified. The parent independently verified rendered evidence. Implementation is complete; the final documentation commit and protected release remain separate gates. Existing production-provider execution, complete initial-input measurement, and deployment limitations remain inherited from PR 2823.

## Release handoff

Promote the compatible runtime before Web exposure and verify warm-container convergence. Production Web currently assigns domains automatically, so hold automatic domain assignment during this release, restore its prior setting after the runtime is verified, and promote the compatible Web candidate. Do not bypass protected CI or deployment checks. No production rollout has been claimed by this implementation record.
Completed: 2026-09-04
