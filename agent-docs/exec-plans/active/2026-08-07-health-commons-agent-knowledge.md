# Health Commons agent knowledge retrieval

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Let Murph use the source-backed Health Commons for ordinary health questions,
  without requiring an experiment or protocol.
- Keep normal messages fast and keep retrieved context small.

## Root-cause evidence

- Health Commons already owns detailed claims, source findings, appraisals, and
  safety boundaries, including a broad dry-sauna corpus.
- The assistant prompt sends only protocol discovery and experiment work to the
  compact Health Commons protocol commands.
- Ordinary health answers therefore do not have a bounded read path into the
  claim and source corpus.

## Success criteria

- The Health Commons build produces one ignored, read-only SQLite FTS index from
  the authored catalog.
- One bounded CLI command returns the best claim, typed source finding, and
  safety context for a health topic with direct source locators.
- Murph uses that command for substantive health questions and does not use it
  for jokes, acknowledgements, logistics, or unrelated messages.
- A missing or invalid index does not block the reply and never weakens health
  safety rules.
- Focused proof covers sauna retrieval, source provenance, result limits,
  irrelevant-message prompt policy, and missing-index fallback.

## Scope

- Health Commons generated search projection and read-only runtime reader.
- One bounded `vault-cli commons knowledge search` command.
- Assistant guidance for ordinary health-question retrieval.
- Focused generator, runtime, CLI, and prompt tests.
- Matching architecture and Health Commons documentation.

## Constraints

- Authored Markdown and JSONL remain the only source of truth.
- SQLite is a generated projection. It stores no user data and has no runtime
  writes or migrations.
- Use the Node runtime SQLite module. Add no package or external service.
- Return at most three evidence items plus one safety item by default.
- Do not load the full catalog or source files during an assistant turn.
- Do not turn retrieved knowledge into an experiment unless the user asks.

## Tasks

1. [complete] Prove the existing assistant knowledge gap and sauna coverage.
2. [complete] Add the deterministic SQLite projection and bounded reader.
3. [complete] Add the CLI surface and assistant routing guidance.
4. [complete] Add focused failure, relevance, provenance, and limit tests.
5. [in progress] Run verification, exact-head reviews, CI, and close the plan.

## Decisions

- Extend the existing Health Commons owner and `commons` CLI boundary.
- Index claim-sized rows instead of whole files. This keeps answers useful while
  avoiding large context loads.
- Use lexical FTS search. Murph translates the user's topic into a few English
  search terms, so no embedding model or vector database is needed.
- Keep one search call as the normal path. A second search is allowed only for
  a separate evidence or safety clause about the same topic.
- Load SQLite only when the knowledge command runs. Use a contentless FTS table
  and omit source-only overview rows to keep the generated index near 19 MB
  instead of the initial 54 MB.
- Ship the index in the existing hosted-runner Health Commons package allowlist.
  Do not add a new runtime service or network request.
- Preserve the July 2026 Bryan Johnson sauna post as research input only. Its
  claims and cited themes are already covered by stronger existing source pages,
  so the authored corpus does not gain a duplicate page.
- The first PRO review found three retrieval risks. Safety now uses an
  independent exact-topic lookup. Short qualifiers such as vitamin B and type 2
  stay attached to the prior word. Ranking uses direct text relevance before
  evidence design, and broad editorial categories are not search terms.
- Full-catalog tests cover safety-only sauna results, nearby-topic rejection,
  one-character qualifiers, and the direct sauna systematic review. A real
  assistant harness also covers the lookup without experiment creation.
- Round 2 reproduced the same wrong-topic mechanism through citation-title
  composition and Porter stems. The retrospective kept SQLite but redesigned
  eligibility around typed ownership: canonical entity titles and authored
  aliases resolve topic keys first. Evidence text and its one returned source
  title can rank rows only after that step. Ordinary evidence and independent
  safety must share a resolved owner key.
- Round 3 separated topic resolution from the user's question. The command now
  resolves an exact normalized title or alias, then uses focus terms
  only to rank evidence and matching safety inside that owner set. Ambiguous
  topics return nothing, while an exact title wins over an alias. BM25 text
  relevance ranks before evidence priority.
- The same correction removed every unsourced overview row and its selection
  path. Ordinary results now always carry direct source references. Topics with
  overview prose but no sourced claim or finding return no packet.
- The real assistant harness now forwards the model's command to the generated
  index through the actual CLI entrypoint. It no longer returns a fixed sauna
  fixture.
- Round 4 found that source findings retained source-page keys after source
  pages stopped acting as topic owners. Findings now inherit an authored
  `related_protocol` target, or a `parent_family` fallback. Their direct source
  locator and `evidenceUse` limit stay in the returned item. Untargeted findings
  are not generated.
- Direct families and child protocols with the same normalized title now share
  the family owner. Unrelated equal aliases still return no packet.
- Independent evidence and safety clauses may use two strict same-topic
  searches. Murph combines at most three distinct evidence items and one safety
  item only when both catalog hashes match. Simple questions stay on one call.
- The real assistant harness now receives the actual CLI entrypoint variables
  in the Health Commons probe itself. The public result ceiling is three items.
- Round 5 found that page-level multi-protocol relations copied each finding to
  every protocol, while measurement-only findings were omitted. A finding now
  gets at most one target: one related protocol, otherwise one parent family,
  otherwise one measured biomarker. Ambiguous pages emit no finding rows.
- Round 5 also found that aggregate page safety text used unrelated page-wide
  citations. The projection no longer emits those rows. Safety results now come
  only from directly sourced safety claims or typed findings.
- Round 6 found that family aliases were copied to child protocols even when
  the corpus said those variants were not interchangeable. Only the canonical
  family title now expands to its typed children. A family alias stays on the
  family unless a child authors that phrase itself. Regression coverage keeps
  UC-II separate from hydrolyzed collagen and keeps cold showers and winter
  swimming separate from Cold Plunge.
- Topic and focus normalization now remove combining marks after Unicode
  decomposition. This makes the authored `V̇O2max` alias usable. Focus searches
  also keep every term instead of silently dropping terms after the eighth.
- Round 7 found that broad questions could omit focus and rank copied topic
  labels instead of the member's intent. Every assistant lookup now requires a
  short focus, including broad intent such as `health benefits`. It also found
  reducer-only appraisals in member-facing results. Candidate-row and shard
  bookkeeping is now excluded until source-level extraction creates readable
  evidence.
- Round 8 required a requirement-level retrospective because both mechanisms
  repeated. Broad questions now use the exact `overall evidence` class; other
  focus remains a strict predicate. Results distinguish an unresolved topic
  from a resolved topic with no matching evidence. All appraisal rows leave the
  assistant projection; only sourced claims and extracted typed findings remain.
  Focus is a required positional CLI input, so generated types match runtime.
- The round-cap decision and retrospective are recorded on PR #1405. No new
  service, model, database, state owner, or query language was added.

## Verification

- `pnpm --dir packages/health-commons verify`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- Focused Health Commons, CLI schema/command, and assistant prompt tests.
- Focused Cloudflare runner packaging and deploy-artifact tests.


## Final simplification

- The agent now sends one natural-language health question. It does not resolve an
  exact catalog title, invent a separate focus, use a magic broad-evidence token,
  merge multiple calls, or compare catalog hashes.
- Topic resolution, family expansion, evidence ranking, safety selection, and
  packet limits stay behind the Health Commons runtime boundary.
- The stable assistant rule is one lookup before substantive health claims, with
  no experiment suggestion unless the member asks to try or track something.
