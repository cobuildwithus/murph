# Reduce assistant context and tool discovery overhead

## Outcome and invariants

Reduce repeated provider input while preserving current memory, canonical evidence,
complete tool constraints, authority, and private/group audience isolation. Do not
modify the native Codex source, model selection, or compaction thresholds.

## Owners and evidence

Assistant-engine owns context composition, native App Server requests, tool
contracts, and prompt guidance. Before this change, current state was appended to ordinary user input
on every turn. Tool discovery could repeatedly print full contracts. Canonical vault records remain truth.

## Approach

- Prove the existing named-context RPC transport against the pinned native binary,
  including unchanged state, changed/cleared state, long Unicode data, compaction,
  restart, and context authority. Use it only if exact content survives; otherwise
  retain the current safe transport and report the remaining limitation.
- Narrow tool discovery and operational contracts without removing validation or
  capabilities. Preserve complete action-specific constraints.
- Prefer existing semantic reads and avoid redundant detailed output for summaries.
- Add production-derived deterministic and real Sol journeys before claiming savings.

## Product UX

Outcome: equally accurate and personalized replies with less input overhead.
Reaches: private established-member questions, memory corrections, follow-ups,
reminder inspection and mutation, and group isolation.
Proof: exact provider inputs, canonical read/write effects, compaction and cold
resume continuity, and focused real-model replies. No real delivery providers.

## Failure and compatibility

No new canonical state or database migration. Native RPC behavior must be tested
with the existing pinned binary. Any transport change must preserve refresh after
compaction and cold resume and fail without silently truncating data. Existing
validators and delivery owners remain authoritative. No deployment is included.

## Steps

- [x] Implement and prove context transport.
- [x] Reduce discovery/contracts and redundant output.
- [x] Run focused tests, typecheck, complete-input comparison, and real Sol journeys.
- [x] Review changes, update owner docs, close plan, and make a scoped commit.

## Evidence

Native transport and deterministic proof:
- Full escaped Unicode content survives the pinned per-entry native limit.
- Identical state deduplicates; corrections, clearing, cold resume, and remote
  compaction refresh preserve exact data. Group and maintenance plans omit it.
- Complete canonical contracts survive eager-native, deferred-native, and
  code-only discovery. The read alias rejects mutation actions and uses the
  existing inspection owner. Full mutation schemas remain inline: a reference
  experiment was rejected because native code declarations lost concrete types.
- Focused assistant suites passed: context/planning/runtime/schema/inspection
  (303 tests), contract transport (20 tests, 42 opt-in skips), adjacent tool and
  prompt surfaces plus complete-input captures (147 tests), and final changed
  context/planning/prompt checks (179 tests). Some suites overlap.
- Assistant-engine typecheck, Web typecheck, changelog generation/rendering
  (4 tests), whitespace/privacy review, and complexity guard passed. Complexity
  debt did not increase; no native code changed.

Real GPT-6.1 Sol, local subscription, production prompt and native tool contracts:
- Continuity journey used all 51 delivery-enabled hosted tool registrations.
  Four unchanged-state turns recalled the correct preference. A correction,
  compaction, cold restart, and a malicious quoted external note all preserved
  the correct answer and constraint; zero assistant canonical writes.
- Reminder inventory used one compact CLI read without schema preflight or
  mutation-tool calls. Exact inspection used the read-only alias. A subsequent
  wording edit made exactly one versioned patch, preserved schedule/route/model,
  and left exactly one record. Extra inspection after the patch was justified
  because its returned fields did not include the changed instructions.
- A natural multi-night sleep question used exactly one pattern read with the
  requested provider and date bounds, returned the correct average and usable
  night count, and made zero canonical writes. An initial extra all-provider
  read motivated explicit first-read provider filtering.
- Reply review: Ready for the tested continuity, reminder, and sleep journeys. No live
  delivery provider, production credential, or member-facing send was used.

Paired real-model usage on identical synthetic production-style fixtures at
base `0059089ee5` and candidate (provider-reported input tokens, not an estimate):

| Measurement | Base | Candidate | Difference |
| --- | ---: | ---: | ---: |
| First input | 48,439 | 42,825 | -5,614 (-11.6%) |
| Input added per unchanged turn | 520 | 146 | -374 (-71.9%) |
| Fourth-turn input | 49,999 | 43,263 | -6,736 (-13.5%) |

Candidate post-compaction next-turn input was 44,637; cold restart was 46,196.
These are small synthetic-memory measurements, not a promise about all traffic.
Larger unchanged memory avoids more repeated input. Tool-heavy turns still need
relevant evidence and domain skills; final-answer brevity alone is not the cause.

Complete decoded first provider requests were also captured on the real native
wire with identical individual/group fixtures at base and candidate, including
instructions, messages, tools/generated contracts, and other body fields. The
fixture uses 14/15 individual and 11/12 group registered tools, distinct from
the full live envelope above. Exclusions: transport auth and prompt-cache key;
synthetic filesystem roots normalized consistently. No exact Sol tokenizer was
available; `o200k_base` counts below are explicitly estimates, supplemented by
the actual Sol usage above.

| Scope | Base estimated tokens | Candidate | Delta | Base UTF-8 bytes | Candidate | Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Individual | 36,549 | 30,391 | -6,158 (-16.8%) | 161,984 | 136,607 | -25,377 |
| Group | 37,252 | 35,555 | -1,697 (-4.6%) | 168,929 | 161,798 | -7,131 |

Reproduction: run `pnpm test:assistant:live -- --test "<unique name>" --codex-command <pinned-native-codex>` separately for
`token efficiency preserves current memory`, `token efficiency lists inspects`,
and `token efficiency answers a natural multi-night`;
credential-free suites use `MURPH_TEST_CODEX_COMMAND=<pinned-native-codex>`.
The complete-input fixture is opt-in with `MURPH_TOKEN_INPUT_MEASUREMENT_DIR`
pointing to a private temporary directory. Compare separate base/head checkouts;
do not reuse candidate builders to simulate the base.

## Completion and remaining boundaries

No added provider, database, network, or canonical-memory read on the foreground
path. In-memory hashing/chunking replaces repeated prompt composition. Deferred
contracts can require one discovery step when used; live reminder inspection and
mutation proved the required canonical effects. No model downgrade, native CLI
patch, context-limit change, migration, or production mutation.

Recommendation: keep current compaction limits and measure natural traffic after
an authorized rollout. Native retention still carries historical user messages
and changed snapshots, and required domain evidence can still grow context.
Raising the threshold would hide rather than remove that cost.

Deploy/rollback: this is a runner-only change using the existing pinned native
RPC and feature configuration. No cross-service writer/reader dependency or
canonical schema change. Existing tool-contract fingerprints own declaration
changes; old/new runners retain their own normal prompt/context assembly.
Validate current-state recall, corrections, reminder inspection/patch receipts,
and input growth after rollout. External review and exact-head CI belong to a
future authorized PR; this task ends at a scoped local commit. No deployment.

Changelog: added `2026-11-06/lower-conversation-overhead`; PR provenance remains
empty until a PR is created. Existing Frog entries cover the local binary and
prepared CLI fixture prerequisites; no duplicate friction entry was created.

Status: completed
Updated: 2026-11-06
Completed: 2026-11-06
