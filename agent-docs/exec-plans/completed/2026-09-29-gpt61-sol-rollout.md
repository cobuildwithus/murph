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


## Source delivery closeout

Both implementation candidates have a valid final ReviewGPT round-1 PASS. Compatibility PR #3818 was reviewed at `827b8e833c6c910f6dbec08462d22ed5bec3190e`; activation PR #3819 was reviewed at `f04e07866063098b411549f50dfd80cec7159139`. Both Hercules/6Pro reviews completed after more than the required three minutes with exact-turn capture and the completion marker. Neither returned a qualifying finding. One activation tooling attempt failed before send on an unavailable browser profile; its successful same-head retry preserves the original baseline.

Post-review changes are isolated test/fixture corrections and ordinary base merges. Compatibility proof fixes cover additive model enums, the pricing error string, and one inspected Linux binary linker false positive. Activation proof fixes cover old managed-model expectations and current-model hosted E2E fixtures. Shared/deploy/egress tests passed 55/102 cases; the final egress rerun passed 11; managed automation/schema tests passed 122; pricing tests passed 144. Relevant typechecks pass. The local Docker daemon is unavailable, so full hosted E2E proof remains with the protected deployment workflow; no local full-stack pass is claimed.

The first compatibility candidate passed all required CI, including the native-image bundle/latency job. A later documentation-index conflict required another base merge and fresh exact-head CI. Both plan references now sit beside the existing GPT-6 model plan entry. No production implementation was authored during conflict resolution, and the original reviews remain valid under the documented test, explanatory-doc, and base-update exemptions.

This archive closes source implementation and review preparation, not production rollout. At this snapshot neither PR has merged and no production mutation has been made by this task. The two PRs own the remaining exact-head CI and release receipts. Compatibility Web and runner convergence remains mandatory before activation. The existing private production environment variable `HOSTED_ASSISTANT_MODEL` is explicitly pinned to `gpt-6-sol`; activation must update it to `gpt-6.1-sol` through the authorized deployment path after compatibility convergence. Protected full E2E/smoke gates, served Web revision, native release convergence, and bounded model-usage evidence remain the release checks. No stored schedule rewrite or production rollback is authorized by this record.
Status: completed
Updated: 2026-09-29
Completed: 2026-09-29
