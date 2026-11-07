# Evaluate and improve 200 realistic assistant scenarios

Status: completed
Created: 2026-11-07
Updated: 2026-11-07

## Outcome and boundaries

Exercise 200 distinct realistic real GPT-6.1 Sol turns across 20 workflows on
isolated copies of an existing user-provided vault. Measure context growth,
tool output and action correctness, then fix proven recurring inefficiencies
without weakening accuracy, clinical safety or mutation authority. Keep the
native CLI, model target and compaction thresholds unchanged. No external
messages, production mutation, deployment or PR creation. Local subscription
use and simulation writes are explicitly requested; original records stay intact.

Continue the owned clean efficiency branch from a50ca4cc8d30. Private prompts,
replies and vault copies remain in private temporary diagnostics; public regression
fixtures are independently synthetic. Do not copy real records into this plan.

## Execution

1. Build an enumerated 200-case manifest and resumable private replay harness
   using production planning, native tools and canonical CLI. Independent workflows
   start with fresh copied vaults; follow-up turns share context. External hosted
   ports fail closed; explicitly requested writes are local to the copy.
2. Run and review all 200 cases. Track execution success separately from answer,
   effect and coverage verdicts; record failures and unsupported harness surfaces.
3. Prioritize high-cost repeated reads and correctness issues. Prove each cause,
   fix its owner and add deterministic tests before focused real-model reruns.
4. Rerun affected realistic cases plus synthetic production-derived regression
   journeys. Compare like-for-like metrics and preserve known success paths.
5. Run relevant typechecks, tests and complexity review; update owner docs and
   changelog as appropriate, inspect privacy and finish a scoped local commit.

## Progress

- Prepared 200 turns across 20 isolated workflows with native Sol and production
  prompt/tool/CLI composition. Baseline remains pinned to the starting head in a
  detached task checkout while improvements run in the owned branch.
- Initial recall runs identified capture-policy loading for aggregate food reads,
  full-panel reads for one lab marker, unfiltered regimen inventories, and broad
  event bodies for title/date listings. Existing canonical queries cover most
  cases; only regimen kind filtering needed a new optional CLI argument.
- Implemented targeted routing and retained numeric safety, ambiguity fallbacks,
  source/unit/date uncertainty, and requested or saved detailed answer formats.
- Focused deterministic boundaries and CLI filter-before-limit proof pass.
  Synthetic live proof covers partial nutrition, lab units/flags, medication
  status, Journal dates, and broad versus saved-detailed sleep summaries.
- Completed and reviewed all 200 baseline turns, plus 140 copied-vault replay
  turns during iteration. Nine focused synthetic live journeys pass (11 turns,
  including two-turn meal and knowledge flows). The native model is gpt-6.1-sol,
  using local subscription auth. No native CLI or compaction-limit changes.
- Corrected repeated capture-policy loading across follow-ups. Complete skill
  instructions remain required after compaction or an incomplete read.
- Medication history now distinguishes regimen inventory from historical courses
  and intakes. Workout edit help distinguishes manually calculated end times
  from independent measured/paused timing; synthetic canonical readback proves
  the corrected elapsed duration and calculated end remain consistent.
- Knowledge discovery documents the real index surface and carries known source
  references into follow-ups. The focused synthetic journey passes, but broad
  copied-vault retrieval still varies; see the explicit Hold below.

## Product UX

Outcome: answer ordinary recall questions with less unnecessary context while
retaining the requested facts and uncertainty. Reaches: private food, sleep,
lab, medication and Journal recall plus their follow-ups. Proof: synthetic
production-derived assertions and paired copied-vault workflows; mutation,
saved-preference, hypothetical, compaction and cold-resume cases remain covered.

## Evidence and limitations

- Report actual completed case counts, failures and review coverage, not inferred
  success from exit codes. Replays are stochastic local evidence, not production
  deployment, end-to-end external delivery or a guarantee for every future turn.
- Existing Frog entries cover pinned-native selection and prepared CLI contract
  generation; reuse the established setup.

## Results

The 20 workflows covered meal recall, nutrition coverage, sleep, recovery,
workouts, body measurements, supplements, goals, reminders, labs, clinical
history, Journal/knowledge, memory corrections, meal corrections, workout
corrections, measurement corrections, reminder lifecycle, goal lifecycle,
cross-domain review, and compaction/cold-resume/quoted-instruction boundaries.

All 200 baseline turns completed. The 140 read-only turns had zero canonical
audit writes and zero changes in the audited file roots. The harness initially
hashed bank, ledger and journal; CORE.md/vault.json coverage was added before
workflow 9 and derived/knowledge before workflow 18. Do not interpret this as
identical exhaustive filesystem coverage for every baseline turn. The six
mutation workflows produced respectively 5, 5, 5, 4, 6 and 6 requested writes;
canonical final reads checked exact values, statuses and lack of duplicate
records. The original archive was never modified. External delivery was disabled.

Paired examples, estimated tool-output tokens using o200k_base:

| Question category | Baseline | Improved replay | Reduction |
| --- | ---: | ---: | ---: |
| Food-log coverage | 14,017 | 2,086 | 85% |
| Broad sleep recap | 10,327 | 1,030 | 90% |
| Single lab-marker history | 21,978 | 2,593 | 88% |
| Latest clinical encounter | 5,143 | 663 | 87% |
| Journal titles and dates | 20,835 | 6,419 | 69% |

Full ten-turn workflows provide a less selective view. The last parent request's
actual input tokens, from native token-usage notifications:

| Workflow | Baseline | Latest relevant replay |
| --- | ---: | ---: |
| Meal recall | 53,201 | 49,657 |
| Nutrition patterns | 63,656 | 58,416 |
| Sleep patterns | 58,467 | 55,516 |
| Lab history | 62,341 | 55,423 |
| Clinical history | 61,588 | 58,839 |
| Journal/knowledge | 92,582 | 98,425 |
| Meal corrections | 51,115 | 54,250 |
| Workout corrections | 47,398 | 47,646 |
| Goal lifecycle | 61,486 | 60,070 |
| Cross-domain review | 79,118 | 66,918 |
| Compaction and continuity | 48,648 | 50,487 |

These are incremental paired replays, not all rerun on the final source snapshot.
They are context/output measurements, not total billed-token savings. Root
traces do not expose all delegated-child usage. Stochastic tool choice adds
variance; several workflows stayed flat or increased. In particular, the
intermediate meal correction run grew to 81,138 tokens by repeatedly loading
capture policy; the reuse fix reduced that to 54,250 without losing supplied
nutrition, correction identity or timestamps.

The baseline here already includes the earlier deduplication and bounded-read
commits. Among nonnegative successive baseline context deltas, median growth
was 363 tokens and the 90th percentile was 3,358; isolated large reads still
added up to 14,388. This does not establish a universal per-turn growth rate.
Forced compaction in the final continuity replay reduced parent input from
49,587 to 44,768; cold restart continued with the same saved facts. The initial
private-vault context and retained instructions explain why compaction does not
reset the conversation close to zero. The earlier reported 74k post-compaction
observation used a different thread and is not a paired comparison.

Complete first-provider-input capture used the same synthetic direct/group
fixtures, native CLI, tools, model and transport with a credential-free provider
stub. Only prompt_cache_key was omitted and local paths normalized. UTF-8 bytes
and o200k_base estimates include the complete captured input, not just prose:

| Route | Baseline bytes / tokens | Final bytes / tokens |
| --- | ---: | ---: |
| Direct | 138,166 / 30,736 | 140,849 / 31,264 |
| Group | 161,798 / 35,573 | 161,974 / 35,611 |

The direct fixed-input cost increased 528 tokens (1.7%) for more explicit read
routing; group increased 38 (0.1%). The intended savings are avoided repeated
large reads, not a smaller initial prompt. No new DB, network or provider
operation was added to the foreground path; regimen filtering uses the existing
local registry read, and applies kind before its public result limit.

## Review verdict and remaining limits

Ready: focused food aggregates and missingness, saved sleep detail, filtered
labs with original units/flags, medication regimen status, Journal title/date
reads, capture-policy reuse, manual workout timing correction, canonical
mutation lifecycles, and continuity through compaction/cold restart. Replies and
canonical effects were reviewed, not inferred from process exit status.

Hold: claiming exhaustive broad knowledge recall or uniform token savings.
One follow-up missed a personal rationale present in a long saved wiki page;
an independent source inspection confirmed the fact exists. Passing known
references and fixing index discovery did not reliably resolve the miss in the
full workflow, although the synthetic two-turn inventory/body read passed.
Large combined page reads and delegated discovery remain areas for further
bounded section retrieval work; the exact child-level omission cause is not
proven by the root-only traces. This is documented as an unresolved stochastic
coverage gap, not counted as an accuracy pass or attributed conclusively to the
new routing. Do not claim all 200 answers are correct or release a guarantee of
unchanged exhaustive retrieval from these results.

Recommendation: keep compaction thresholds and Codex CLI unchanged. The measured
waste is primarily in Murph's context/read routing. Raising the threshold would
retain more of that waste. Prioritize bounded wiki-section discovery and complete
parent-plus-child usage accounting next; preserve source coverage and exact
record fallback instead of imposing blanket output truncation.

## Verification and completion

- Focused assistant deterministic tests: 28 passed across imported recall,
  longitudinal sleep and health-record prompt invariants on the final prompt.
- CLI health-tail, workout typed-parity and structure guard: 42 passed.
- Nine focused real-Codex scenarios passed: partial food coverage, broad sleep,
  saved detailed sleep, lab history, medication regimens, Journal dates, manual
  workout timing correction, two-turn meal policy reuse, and two-turn knowledge
  inventory/content follow-up. Commands use `pnpm test:assistant:live -- --test`
  with each named test and the requested native Sol CLI/subscription profile.
- `pnpm --dir packages/assistant-engine typecheck`,
  `pnpm --dir packages/cli typecheck`, and
  `pnpm --dir packages/vault-usecases typecheck`: passed. Final assistant
  typecheck includes the final live-test addition.
- Complete provider-input capture: two synthetic route tests passed at baseline
  and final. `pnpm complexity:diff` and `git diff --check`: passed. Existing
  hotspots were inspected; this change adds no complexity debt.
- Parent reviewed authored source, test assertions, generated contracts, privacy
  and aggregate evidence. Public fixtures are independently synthetic; no private
  questions, replies or records are copied into source or documentation.
- Changelog decision under write-changelog: group this work with the same
  branch's existing unshipped `2026-11-06/lower-conversation-overhead` item. It
  already describes focused health/reminder reads and preserved correction facts;
  avoid a duplicate release note or claiming uniform savings.
- Local scoped commit only. No PR, CI, external review, merge or deployment was
  requested or performed. Release review must retain the coverage Hold above.
Completed: 2026-11-07
