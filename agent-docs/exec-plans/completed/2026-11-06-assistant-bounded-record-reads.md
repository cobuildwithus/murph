# Reduce assistant record-read overhead

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal and boundaries

Reduce context growth for ordinary read-only health questions while preserving
complete evidence, uncertainty, safety and canonical ownership. Continue the
owned token-efficiency branch. No native changes, threshold increases, external
delivery, deployment or production mutation. Private replay evidence stays outside
the repository; regression fixtures are independently synthetic.

## Evidence and decisions

- An eight-question local Sol replay found a broad measurement list producing
  roughly 88,000 estimated output tokens before native truncation, followed by
  metric reads. Existing scalar entry reads already provide lossless filtering.
- Supplement inventory required a summary plus full per-record reads. Add an
  opt-in complete list using the existing canonical query and read projection;
  retain every dose, ingredient, note, body and link without summary truncation.
- Preserve default list behavior and mutation contracts. Do not shorten clinical
  guidance or raise compaction limits to hide inefficient retrieval.

## Tasks and verification

1. Route scalar questions to filtered entries and supplement inventories to a
   single complete read. Test full notes, missing doses, inactive filtering and
   unchanged default summaries.
2. Run focused deterministic tests and relevant package typechecks/build.
3. Add and review focused synthetic real Sol journeys, including conflicting
   measurements and incomplete dosing; assert no canonical writes.
4. Replay the same private eight-question sequence and compare context growth.
5. Review diff, privacy, complexity and outcome; update owner docs and finish a
   scoped local commit. CI and deployment remain separate.

## Progress

- Implementation complete. The first detailed-list candidate repeated frontmatter
  and exceeded native output bounds on the larger replay. The final projection
  keeps complete typed fields and body while omitting that duplicate serialization.
  Exact show and compact default lists are unchanged; missing-body records fall
  back to full markdown. Personal reminder reads use existing status and maintenance
  filters and check coverage.
- Deterministic proof: 15 CLI tests, 24 usecase tests, and 91 assistant prompt tests
  pass. Prepared runtime build and all three affected package typechecks pass.
  Web typecheck and 43 changelog registry/render tests also pass.
  Complexity guard passes with no debt increase; existing hotspots are unchanged.
- Three focused real GPT-6.1 Sol journeys via local subscription pass: conflicting
  weights, missing versus saved supplement doses with a long stop note, and active
  personal reminders versus paused/internal routines. Each uses one canonical data
  read and makes zero canonical writes. Replies reviewed Ready.
- An isolated eight-question replay used an existing private vault copy, fresh
  conversation, production prompts/tools and the pinned native runtime. External
  ports were disabled and no delivery or canonical writes occurred. Actual provider
  input grew from 39,845 to 85,773 tokens before this follow-up and from 40,158 to
  65,979 after it: 45,928 versus 25,821 growth (44% less), ending context 23% lower.
  This is context usage from one paired sample, not a billing or accuracy guarantee.
- Per-turn context growth: weight 11,574 to 1,828; supplements 14,252 to 6,556;
  reminders 4,400 to 2,083. Supplement output fell from roughly 9,300 to 6,200
  estimated tokens by removing duplicate frontmatter, eliminating the observed
  truncation/reread cycle. Exact doses, uncertainty, conflicting measurements,
  workout source duplication and saved totals were retained in reviewed replies.
- Food capture policy remains intact; its roughly 5k-token skill load is a remaining
  cost for meal recall. Do not remove its safety contract without separate focused
  capture and numeric-safety proof. No native change or compaction-limit increase.
- Changelog: broaden the existing lower-conversation-overhead item on this owned
  branch to cover the same outcome. No source PR exists yet. No new Frog entry:
  existing local-binary and prepared-CLI-contract entries cover the known setup.
- Local candidate review complete: narrow read-only addition, no new state,
  dependencies or authority path; private replay contents remain outside the repo.
  CI, PR review and deployment have not run and are not claimed.
Completed: 2026-11-06
