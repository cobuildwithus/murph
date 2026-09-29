# GPT-6.1 Sol staged production rollout

The requested local implementation is recorded in the completed model-upgrade plan. The user has now authorized PR creation, ReviewGPT, merge, and deployment. Public Murph owns all source changes; private Murph Cloud provides the existing protected deployment workflow without source edits.

## Safe sequence

1. Compatibility PR: Codex 0.159.1, native catalog, model readers, and published billing prices. Keep GPT-6 Sol defaults, saved automation replacements, and Web choices. Temporarily withhold new-model selection in the existing Web preference owner. No feature-flag infrastructure or state migration.
2. Require focused checks, final ReviewGPT, and exact-head CI, then merge. Verify the Web compatibility deployment and deploy/converge the compatible runner through the protected Murph Cloud workflow.
3. Activation PR: restore the reviewed default and provider-aware reminder upgrade behavior, remove the temporary Web selection hold, and publish the member changelog. Repeat relevant checks, final ReviewGPT, and required CI before merge/deploy.
4. Verify the resulting production revisions, runner Codex version/catalog, default-model projection, and bounded scheduled execution model evidence. Do not claim all historical stored pins were rewritten: resolution upgrades them when they execute.

## Evidence and status

Compatibility candidate prepared. Focused Web preferences/settings/pricing: 231 passed; automation routing/selection: 49 passed; Web, assistant-engine, and hosted-execution typechecks passed. Complexity guard passed with no additional debt. Native patch source/applicability checks and focused model/billing/egress tests from the local implementation remain relevant; rerun affected preference/routing tests and typechecks after staging changes. No production mutations yet.

The broad canonical reminder creation fixture remains independently broken and is recorded in Frog. The focused saved-reminder migration journey passed with a real GPT-6.1 Sol turn before staging and will be repeated for activation. Existing custom provider routing and explicit reasoning remain covered by deterministic tests.

## Activation candidate

Prepared as a dependent branch above compatibility PR #3818. Restore GPT-6.1 Sol defaults, managed reminder pins, provider-aware saved/inherited scheduled upgrades, and Web model selection. The separate compatibility deployment is a hard merge prerequisite for this activation candidate. No production mutation from this branch yet.

Activation proof: 131 automation/managed-reminder tests and 88 Web model/settings tests passed. Engine/shared/setup and Web typechecks, test-runtime build, and complexity guard passed. The focused real subscription journey again executed a saved GPT-6 Sol reminder on GPT-6.1 Sol and preserved its canonical record. Native loopback first-request capture measured identical base/head payload bytes (individual 175,512; group 160,515), excluding prompt_cache_key; deferred automation registration grew by 4 bytes. Exact target tokenizer counts are unavailable, so no token delta is claimed. The real settings component was rendered at 1280px and 390px with the GPT-6.1 Sol radio selected; desktop and mobile screenshot inspection passed. The synthetic design fixture now reflects the activated model.
