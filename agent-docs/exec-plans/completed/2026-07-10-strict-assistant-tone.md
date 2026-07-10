# Make Murph tone preferences strict and default formal

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make a saved casual tone a strict lowercase-casual writing contract across every user-visible Murph response, while making formal the single shared default when no tone has been saved.

## Success criteria

- The tone picker preselects formal for members without a saved choice.
- Prompt assembly resolves an absent tone to formal and expresses both tone choices as concrete, persistent writing rules rather than optional suggestions.
- Casual applies to progress, tool/result, blocker, question, and final-response prose without drifting back to sentence-case; casing-sensitive literals remain exact.
- Formal uses standard capitalization, complete sentences, and no casual shorthand or slang across the same response surfaces.
- Focused regression tests, required typechecking/verification, prompt review, frontend review, and final local review pass.

## Scope

- In scope: shared tone default, prompt wording and prompt regression proof, picker default and focused UI proof, tone-and-voice product contract.
- Out of scope: changing saved member choices, voice selection, generated voice previews, unrelated assistant personality or messaging flows.

## Constraints

- Technical constraints: keep one shared default; do not add state, migrations, or duplicate prompt owners; preserve exact casing for literals where casing carries meaning.
- Product/process constraints: preserve the current two-choice product and health/safety clarity; follow current GPT-5.6 prompt guidance; coordinate with the active thread-context prompt work without overwriting it.

## Risks and mitigations

1. Risk: a broad lowercase rule corrupts URLs, code, identifiers, acronyms, or quoted text.
   Mitigation: scope lowercase to authored natural-language prose and explicitly preserve casing-sensitive literals.
2. Risk: the UI and runtime disagree about the default.
   Mitigation: export and consume one shared formal default in both surfaces, with direct tests.
3. Risk: stable base-personality wording conflicts with the selected formal tone.
   Mitigation: keep the base personality tone-neutral and let the preference block own capitalization, slang, and register.

## Tasks

1. Trace the persisted preference, picker fallback, prompt assembly, and notification path.
2. Add the shared formal default and tighten/neutralize prompt wording.
3. Update focused prompt, picker, contract, and product-spec proof.
4. Run scoped verification and direct prompt readback.
5. Run required prompt and frontend completion audits, reconcile findings, perform final local review, and finish with a scoped commit.

## Decisions

- An absent preference means formal rather than "no tone guidance"; this preserves optional persistence while giving every turn deterministic behavior.
- The saved casual choice is a true user-facing invariant, so the prompt uses explicit must-language for casing and surface coverage.

## Verification

- Focused assistant prompt test: 53 passed.
- Focused assistant-style picker test: 12 passed.
- Scoped picker lint: passed with no warnings.
- Diff-aware workspace verification: passed, including dependency policy, workspace boundaries, affected package/app typechecks and tests, the hosted web production build, and Cloudflare verification.
- Direct readback: `git diff --check` passed; stale optional-tone wording and the casual picker fallback are absent from the scoped source and contract.
- Prompt review: no findings; the contract is concrete, compact, and aligned with current GPT-5.6 invariant guidance. Live-model adherence replay remains a non-blocking pre-release check.
- Frontend review: no code, product, accessibility, or layout findings. Live desktop/mobile browser verification was attempted but no in-app browser surface was available; the supplied screenshots, unchanged layout markup, focused DOM test, full web suite, and production build provide the available proof.
- Coverage review: one moderate test-only proof gap was resolved by asserting the full response-surface list, casing exceptions, and concrete notification rules. Focused assistant tests remain 53 passed.
- Post-review typechecks: contracts, assistant-engine, and hosted web passed. Post-review picker tests (12 passed), scoped lint, assistant tests (53 passed), and `git diff --check` passed.
Completed: 2026-07-10
