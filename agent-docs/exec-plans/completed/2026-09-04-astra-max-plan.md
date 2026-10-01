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

PR #2823 links the changelog, reviewed phone/desktop screenshots, and the ready
hosted settings preview. CI exposed a missing Astra entry in the pinned Linux
Codex catalog; a legacy-only compatibility entry now passes native Linux loading.
The image retains a default three-model catalog and a separate Astra catalog,
selected from Web's canonical Max/OpenAI workspace authority. This closes the
delegated-task entitlement gap reported by the diagnostic external review while
preserving existing Edge/group child choices. The settings save announcement also
now names Astra correctly. Five native scripted delegation checks pass, including
Astra rejection without authority and an Astra provider request with authority.
The exact Docker catalog commands load both profiles in the pinned Linux image.
Composed Web eligibility/workspace, settings, and preference checks pass (136),
as do runtime configuration (47), shared control contracts (35), and container
catalog/preflight checks (96). Affected typechecks and the complexity guard pass.

The first external review was rejected by model verification: ChatGPT selected
GPT-6 Pro while the wrapper expected GPT-5.6 Sol. Its returned findings were
treated as diagnostic input and verified locally, not accepted as a completed
gate. The recovered round-two review of 0de2a4a0ff4586e52ba5b685c02a6478071867ce
returned `ROUND_OUTCOME: PASS` and `REVIEW_COMPLETE`, with no merge-veto findings.
All required CI checks passed on that reviewed head.

Continuation reconciled main at 88eef98e75 through one ordinary merge. The
Docker conflict combines Astra authority/catalog selection with main's mixed
Code Mode. The existing native test transform moved to main's shared catalog
helper; obsolete inline helper and narrative-doc assertions stayed deleted.
Architecture prose preserves both behaviors, and the index retains main's
compact routing descriptions. No new product behavior was authored by the
resolution, so the resolved review carries forward under the base-update rule.

After reconciliation, the container/preflight suite passes all 96 tests; seven
native scripted cases prove direct/group Luna delegation, authorized Astra,
unauthorized/unknown-model rejection, and Terra schema discovery. Assistant-engine
and Cloudflare typechecks and the complexity guard pass. The final pushed head
still requires CI; its results belong in PR #2823. The task-owned ReviewGPT alias
friction note is included in the completion commit.

Product verdict: Settings/API and conversational model selection are Ready.
Actual Astra provider execution, full provider-visible input measurement,
production API-account access, mixed-version rollout, and warm-container adoption
remain unverified. No production deployment or merge of the PR was performed.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
