# Bound factual research and improve food search

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Goal and scope

Return useful source-grounded meal estimates without repeated research or browser escalation. Improve food-search latency and identity matching, targeting 2–3x where measurements support it. Reuse existing instruction, SQL, and meal owners; no production data mutations, new stores, caches, migrations, or private conversation fixtures.

## Decisions

- Reuse verified nutrient densities on quantity corrections. Batch unresolved components, search official web sources after a database miss, and stop with a marked estimate for routine calories/macros when bounded research fails. Exact safety and explicit exactness requests retain evidence requirements.
- Put detailed nutrition rules in food-journal and general public-fact routing in computer-use and its resident trigger. Preserve the current task-authorization and browser-completion rules. Resident instruction character count and existing prompt-size ceilings stay unchanged.
- Current main already has bounded selective candidate admission; preserve it. Private ranking uses complete name/brand identity with one computed vector, retaining extended text for indexed discovery. Admit additional strict-word typo matches only inside the existing whole-name candidate bound, after existing whole-name matches. Public and supplement search retain their contracts.
- Opus 5.5 independently reviewed the current-base approach and supported preserving admission bounds and original typo priority. No additional scan branch or roundtrip is added.

## Integration correction

The initial local origin/main reference was stale. The branch was reconciled with current main at 347d343b6c7285153edaad55d3f74a2f51a564cf through an ordinary merge preserving published history. The current implementation was rebuilt against that source. Earlier measurements against d778cfff36 are superseded and are not current evidence.

## Verification

- Current-base local PostgreSQL: 214 tests passed across supplements-search-postgres, foods-lib and supplements-lib, including brand/descriptor distractors, long-name typo recovery, unrelated misses, stemming, generic diversity, public projection, and more-than-10,000 ineligible neighbors.
- Full hosted-web typecheck and final prepared typecheck passed. Assistant-engine typecheck passed. Focused assistant tests: 103 passed across nutrition grounding, food-journal, automatic capture, browser routing, and model behavior. Changelog generation and 10 archive tests passed.
- GPT-6.1 Sol, low reasoning, local subscription: production prompt/base, real dynamic-tool contracts, synthetic CLI results, and real public web search. Correction: zero lookups or browser calls and correct totals. Known label miss: one database lookup, two web calls, zero browser calls, exact official serving values. Unavailable label: one database lookup and one web call, zero browser calls, marked range. Exact allergy: one lookup and one web call, no safety assertion; missing evidence requested. One failed assertion incorrectly matched a negated safety claim; corrected the assertion and reran successfully without changing production instructions. Public-fact journey used one web search, zero database/browser calls, and returned official opening hours. Its time-format assertion was corrected to accept ordinary clock notation and rerun.
- Complexity guard passed against current origin/main. Unchanged hotspots: scoreProductContaminantThreshold (21), buildStableRouteCapabilityPrompt (28), buildAssistantHostedGroupGuidanceText (25). Their independent validation and route-selection responsibilities are unchanged; splitting them adds no demonstrated benefit for this patch.
- Complete native App Server input capture with identical scripted direct/group fixtures: normalized individual bytes 154961→154962 (+1 serialized newline), group 130842→130842. Unescaped resident guidance is 1331 characters on both sides; tool contracts are unchanged. The existing capture fixture uses gpt-5.6-sol with a scripted provider and omits the generated CLI contract. Exact target-model tokenization is unavailable; synthetic usage is not a token count. This is byte/surface evidence, not a GPT-6.1 token measurement.

## Current-base SQL benchmark

120,000 synthetic rows, production-shaped indexes, alternating exact baseline/candidate SQL, six timings per query with the first discarded and the remaining median reported. Top-five identities remain identical across ten benchmark queries; separate adversarial positive top-one quality improves 2/5→5/5 and an unrelated query stays empty.

| Distribution/query | Baseline ms | Candidate ms | Speedup |
| --- | ---: | ---: | ---: |
| Long text/selective | 7.466 | 1.521 | 4.91x |
| Long text/generic | 35.320 | 14.991 | 2.36x |
| Long text/broad | 2150.486 | 1213.875 | 1.77x |
| Short text/generic | 15.100 | 13.297 | 1.14x |
| Short text/broad | 351.389 | 317.885 | 1.11x |

No-hit queries add approximately 15 ms for additional typo recovery (54.861→69.545 ms short text, 67.209→82.528 ms long text). These are local synthetic measurements, not a production-wide speed guarantee. Existing timeout and candidate bounds remain.

## Product UX and remaining gates

Patch; Ready for the verified nutrition journeys. Lower member effort, clear uncertainty, no unsolicited writes, preserved exact-safety requirements. Parent review owns prompt composition and SQL boundaries. Parent candidate and final reviews are complete. Final ReviewGPT returned PASS for 2215a6a96f08ca10ddd6b8d2a1c4bf016f416b35 with verified exact-turn capture on the Hercules lane, selected GPT-6 Pro, attached guarded snapshot and more than nine minutes of response wait; no findings require disposition. The reviewer checked all 13 diff/head blobs and the nutrition/SQL invariants, while explicitly limiting independent runtime proof. Existing required checks are green; the final documentation-only commit retains exact-head CI before the user-authorized merge. The user also authorized post-merge stale-worktree cleanup, preserving dirty, active, and unresolved work. No separate deployment action is included.

## Completion

Implementation, focused local proof, Opus consultation and final review are complete. The final commit only archives this evidence; no production behavior changes after the reviewed head. Merge waits for final-head CI. A task-scoped 14% free-space guard setting was explicitly authorized while retaining the 20 GiB floor and identity hooks; no global guard setting changed.
Completed: 2026-10-01
