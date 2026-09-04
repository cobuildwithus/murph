# Astra for Max

## Outcome and scope

Add GPT-6 Astra to managed OpenAI model selection for active paid individual Max
and active Family Max seats. Preserve Terra defaults and existing Sol access.
Venice and custom endpoint support are outside scope.

## Product UX plan

Product change: extend the existing model choice. Max members can select Astra
for subsequent queries with clear higher-usage copy. Other plans cannot select
Astra through settings or the API. Stored Astra preferences become dormant after
loss of Max access and resume when eligibility returns. Group rooms retain their
existing model choices. Family Max eligibility uses the seat plan, not the shared
Edge runtime tier. Existing custom inference remains authoritative when selected.

## Implementation and proof

- Extend existing model catalog, preference owner, settings, and runtime catalog.
- Price input/cache/output and long-context requests from official OpenAI docs:
  https://developers.openai.com/api/docs/models/gpt-6-astra
- Prove direct and Family Max selection, lower-plan denial, dormant preferences,
  API forwarding, model parsing, standard/flex billing, and threshold boundaries.
- Run focused tests and affected typechecks, rendered settings proof, parent
  review, scoped commit, and the required pushed-head ReviewGPT/CI gates.

## Status

Implementation complete. Focused selection/API/pricing, shared-contract, assistant
configuration/image, Docker catalog/preflight, and changelog tests pass. Web,
assistant-engine, Cloudflare, and hosted-execution typechecks pass; the shared
package build passes. Browser proof passed at 390px and 1280px and was visually
reviewed. Complexity debt decreased in the changed preference/settings owners.

The native catalog validates Astra context at no more than 272K; cumulative
Codex turn/subagent totals therefore use ordinary rates. Exact per-request
records retain long-context pricing. Group and explicit automation model
choices remain unchanged; existing automations may inherit a selected Astra.

The live selection journey passes with the default Terra model: one Astra save,
no provider/reasoning change, and a truthful next-query confirmation. Its synthetic
port now persists the saved model so later reads match production behavior.
Actual Astra execution remains unverified: all ten available local subscription
homes failed before any provider action. The failure wrapper labels this a
cache-probe failure; that label alone does not establish its underlying cause.
The existing Frog cache-probe entry covers this diagnostic failure.

PR #2823 links the changelog and reviewed phone/desktop screenshots. A hosted
preview is building; final external review and broad CI remain outstanding.
Complete provider-visible input measurement is also unresolved. No production
deployment performed.
