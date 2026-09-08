# Complete assistant prompt token reduction

Status: completed
Created: 2026-09-04
Updated: 2026-09-05

## Outcome and scope

Complete the original prompt-token audit beyond the conservative first pass while preserving Terra/Sol completion, truthfulness, privacy, exact timing, clinical guidance, and discovery. The owned branch is codex/prompt-token-compaction. The overall baseline is 61efce27c28bfed62073f677430af29947421b82; the first conservative commit is 8c143951953b2f87b7f0e7af0f1f2ff875c8809a. Measurements below include that first pass and must not be added to its overlapping savings.

## Final implementation

- Automation details have one complete owner in the existing deferred tool. Resident instructions retain discovery, exact timing, versioned changes, route binding, canonical-record authority, and successful readback. A later timing-only question requires current read-only inspection; the no-redundant-inspection rule applies to verification of the already-returned write result.
- Static research and late-child-result policy live in stable route instructions. Dynamic context carries current facts and the trusted ordinary-inbound marker. The existing research admission gate participates in native thread compatibility through the developer-instruction fingerprint. Scheduled and other excluded turns retain their explicit stopping rules.
- Group email omits the skill router, chronic-skill prerequisite, browser procedures, generic CLI execution/recovery recipes, and procedural Commons CLI block. Shared chronic-care reasoning, urgent-symptom handling, evidence honesty, public/private distinctions, sender authority, and inline sleep-safety guidance remain.
- Four existing presentation tools defer full schema loading through Codex's existing mechanism. Resident triggers name both native tool_search and code-mode ALL_TOOLS. Full schemas, prerequisite reads, eligibility, and runtime action gates remain intact. A card's successful attachment ends ordinary authoring without another finish-without-reply call; scheduled turns keep their required terminal decision.
- The exercise-card description makes its existing maximum of three instructions per movement explicit. This avoids a code-only model's unnecessary validation retry when the generated array type omits JSON Schema cardinality bounds.

The durable assistant-engine README records prompt and tool ownership. New runtime code is one optional research capability input, one execution-guidance helper, one browser-guidance switch, and four existing-tool deferral flags. No dependency, state store, scheduler, schema variant, intent classifier, dispatcher, namespace, or private packaging mechanism was added.

## Remaining audit-item disposition

- Retain health-record ingestion rules: source retention, media receipts, clinical assertions, and durable asynchronous completion are distinct obligations rather than duplicate procedural owners.
- Retain private group consultation rules: semantic matching, cursor handling, and disclosure requirements are absent from the terse deferred tool descriptions. Deleting them would lose policy rather than centralize it.
- Reject splitting the private hosted group-chat skill in this public change: its actual private materializer and verifier install six top-level skill files, not the proposed references. The public fallback is not the hosted owner. A working split requires coordinated private packaging changes and cold overlay-discovery proof. No saving from an unimplemented split is credited here.

## Complete first-request measurements

Actual Codex 0.151.0 mixed-mode first Responses requests were captured for identical synthetic fixtures and capability sets, comparing the original eager tools with the final candidate. Counts include assembled instructions, messages, generated tool guidance, and JSON framing. The installed o200k_base tokenizer is a proxy, not a verified model-specific billing counter. Normalize UUIDs and synthetic test-run/fixture directory suffixes. Member history, private skill overlays, production environment, and unseen provider-side instructions are excluded.

| Synthetic route | Base tokens | Final tokens | Token delta | Delta % | Base bytes | Final bytes | Byte delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Private Linq | 37,265 | 32,195 | -5,070 | -13.61% | 171,393 | 146,771 | -24,622 |
| Private Telegram | 39,091 | 32,357 | -6,734 | -17.23% | 179,846 | 147,669 | -32,177 |
| Group Linq | 26,633 | 24,552 | -2,081 | -7.81% | 123,209 | 112,815 | -10,394 |
| Group email | 20,229 | 18,592 | -1,637 | -8.09% | 91,523 | 83,678 | -7,845 |

The authored prompt itself falls by 1,344 tokens on private/group-chat fixtures and 1,604 on group email. Ordinary research-enabled dynamic context falls by 382 tokens (1,913 UTF-8 bytes) per turn; group email falls by 131 tokens (670 bytes). These repeated-turn figures are separate measurements, not extra savings to add to the full first request.

Card-producing turns still load the complete selected contract and add the existing discovery exchange before attachment. These initial-request savings do not guarantee lower end-to-end billing or latency on those turns, nor a provider cache hit. No database query, transport RPC, external-service call, or new retry loop was added to the foreground path.

## Verification and parent review

- 219 unique focused tests passed across model-behavior, system-prompt.dynamic-context, assistant-codex-turn-planning, and assistant-hosted-domain-tools. The only remaining failure after the first remediation run was the expected static-core hash change; refreshing it and rerunning all 82 model-behavior tests passed. Complete-plan hashes now use Vitest inline snapshots. Only affected direct/group/scheduled hashes changed; maintenance/output-only values remained identical.
- Final assistant-engine typecheck passed. The inspection fixture includes the actual preserved-route response contract. No type assertions or runtime validators were weakened.
- Three final scripted tests passed: complete request capture, exact Terra native automation discovery, and code-only automation metadata/dispatch. The unchanged response-card schema/discovery rejection test also passed in the preceding scoped run. An earlier overloaded-machine run timed out at its unchanged 90-second limit; the successful retry required no timeout or assertion relaxation.
- Terra and Sol each passed the final comparison-card journey in explicit native/mixed and code_mode_only catalogs: one successful attachment per mode, no extra dynamic action, no shell command, and empty provider-authored final text.
- Terra and Sol each passed the expanded two-turn appointment journey: one initial save for an 11 AM appointment with the exact 8 AM reminder, then one inspection after the synthetic stored record was paused between turns, no mutation/shell command, and a truthful paused-state answer.
- Terra and Sol each passed the expanded group-email journey: useful low-effort support for a familiar flare, no command or dynamic action, and a truthful authenticated-chat handoff for the requested room rename/reminder.
- Both models also passed the broader routine presentation suite before the discovery wording correction: attended/scheduled Telegram cards, Linq media with complete text, and repeat/improvement behavior. That fixture supplies synthetic CLI results without a full filesystem skill installation; its missing-skill detours do not prove hosted-overlay performance.
- Complexity guard passed against the original baseline. Planning debt fell 206 to 205; prompt debt fell 15 to 13 and maximum 30 to 28. Model-behavior maximum changed 6 to 7 with zero debt; catalog and automation owner debt stayed zero. Existing hotspots are planning (225), main prompt (28), and group guidance (25); further splitting solely for the metric would expand scope without improving instruction ownership.
- Parent reviewed the complete source diff, final assembled prompts, scoped proof, actual synthetic replies, ownership, and privacy. Reply-review verdict: Ready for the tested journeys. Diagnostics retain synthetic effects and command counts, not filesystem command output. No direct identifiers or temporary capture code remain in changed tracked source. No new Frog entry was needed; observed tool/capture friction matched already recorded issues.

Focused commands:

- `pnpm --filter @murphai/assistant-engine test test/model-behavior.test.ts test/system-prompt.dynamic-context.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-hosted-domain-tools.test.ts --update`, followed by the focused model-behavior rerun after its reviewed static hash refresh.
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-engine test test/assistant-codex-scripted-runtime.test.ts --testNamePattern 'captures final compact prompt complete provider input audit|uses exact Terra mixed mode|documents why pinned Codex code-only metadata'` (temporary capture probe removed afterward).
- `pnpm complexity:diff --base 61efce27c28bfed62073f677430af29947421b82`
- `pnpm test:assistant:live -- --test '<journey name>' --model <model>` for both gpt-5.6-terra and gpt-5.6-sol using local subscription auth.

Live journey names:

1. `discovers the deferred comparison card with compact production instructions`
2. `preserves appointment timing and single-write readback with compact shared instructions`
3. `keeps compact group-email instructions conversational without unauthorized actions`
4. `uses complete routine cards on Telegram and semantic text with media on Linq`

## ReviewGPT

The first assessment completed with verified gpt-6-pro identity, three Medium findings, and no confirmed High/Critical regression or new authorization bypass. All three were accepted against source and corrected: support both discovery interfaces; finish group-email prerequisite separation; restore the later timing-query inspection obligation at the automation owner. No large resident policy block or new infrastructure was restored.

A targeted follow-up was submitted with the current public snapshot. The remediated source/README diff against the original baseline has SHA256 1e8eefc33bd281dba180650770af41ad47f6c8e39b79214f85ee2428a80f407a. The expanded group-email live cases, still pending when that prompt was sent, have now passed on both models.

Follow-up assessment completed with verified gpt-6-pro identity. All three prior findings are resolved, with no new actionable correctness, safety, or maintainability issue and no further source correction required within the targeted review. Response SHA256: 7d80d1dc04a295b7e08c65a549457b961393b88fba120097defe9b00868eeca6. The reviewer independently parsed 11 source/test files and ran 150 dependency-isolated production-declaration assertions; it did not execute workspace or live tests. Its pending group-email note predates the final successful Terra/Sol runs recorded above. Final source/README diff still matches the reviewed hash.

## Delivery

Internal instruction-loading change; no new member feature or changelog entry. The pinned Codex already supports deferred tools, and schemas and runtime authority are unchanged. There is no cross-service deployment order or data migration. Changed fingerprints use the existing compatible-thread/replay path; reverting source restores eager advertisement. No production access, delivery, deployment, PR, or CI result is claimed. Final closure uses the existing verified approved GitHub/no-reply commit identity and a scoped local commit.
Completed: 2026-09-05
