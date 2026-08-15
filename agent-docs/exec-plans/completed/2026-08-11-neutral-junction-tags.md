# Store Junction tags neutrally

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep Junction note tags available without asserting that every tag is a
  completed intervention.
- Preserve Personal Patterns support only for an explicit, product-owned set
  of action-like Oura tags while keeping symptoms, context, outcomes, and
  unknown/custom tags neutral.

## Success criteria

- Every retained Junction note tag persists as a privacy-safe neutral canonical
  note with provider provenance and no provider free text.
- Only explicitly allowlisted action-like Oura wearable tags can become
  Personal Patterns factors; non-Oura and unknown/custom tags remain neutral.
- Replays are idempotent, and edited or explicitly cleared provider tag sets do
  not leave stale completed interventions or stale factors.
- Existing note-derived intervention events, if any exist in production, have
  an explicit bounded remediation path; otherwise no speculative migration is
  added.
- Focused importer, core/vault, query, and device-sync proof passes, and the
  exact pushed PR head clears the required ReviewGPT and CI gates.

## Scope

- In scope: Junction note normalization, neutral canonical representation,
  Personal Patterns factor admission, replay/update/delete behavior, bounded
  remediation if production evidence requires it, tests, and matching durable
  docs/changelog decisions.
- Out of scope: retaining note free text, redesigning Personal Patterns
  statistics or thresholds, broad provider taxonomy machinery, and unrelated
  device-import refactors.

## Constraints

- Technical constraints: reuse the existing canonical `note` event and current
  import/backfill owners; do not add a new persisted event kind, service,
  dependency, or state owner; preserve provenance, privacy sanitization,
  bounded history, and kind-stable event-spine invariants.
- Product/process constraints: canonical storage remains neutral; the
  action-like taxonomy is explicit and fail-closed; ReviewGPT supplies an
  implementation patch that the parent inspects before applying; use the
  worktree/PR lane and required exact-head reviews.

## Risks and mitigations

1. Risk: a forward-only kind change conflicts with already-persisted event
   spines or leaves stale derived reports.
   Mitigation: query production narrowly before choosing remediation; if rows
   exist, use an explicit idempotent repair and refresh path.
2. Risk: treating all neutral tags as factors recreates the semantic bug in the
   query layer.
   Mitigation: admit only Oura-origin, wearable-tag notes whose normalized tag
   is in a small product-owned allowlist.
3. Risk: edited or explicitly cleared tags remain live after provider replay.
   Mitigation: preserve one provider-note identity where possible and add
   focused update/clear/replay proof at the canonical import boundary. Complete
   source-row disappearance remains outside this bounded snapshot correction.

## Tasks

1. Ask ReviewGPT for a scoped implementation patch against the current merged
   baseline and inspect its assumptions and affected ownership boundaries.
2. Implement neutral tag persistence and fail-closed Personal Patterns
   admission with the smallest reusable data flow.
3. Add focused proof for Oura/non-Oura, allowlisted/unknown, privacy, replay,
   edit/delete, and kind-stable history behavior.
4. Check production read-only evidence and implement only the remediation that
   evidence requires.
5. Update durable docs and changelog decision, run focused verification, and
   push an exact-head PR candidate.
6. Resolve preliminary and final ReviewGPT findings, CI, parent final review,
   and merge-tree proof; archive the plan in the final scoped commit.

## Decisions

- Reuse canonical `note`; a new `journal_tag` or `context_marker` kind is not
  justified.
- Keep Junction `note` fetching global and privacy-safe. Provider scope and
  action taxonomy belong at derived Personal Patterns admission, not as false
  canonical event semantics.
- Unknown/custom and non-Oura tags fail closed as neutral notes.
- Use the exact normalized `sauna` tag as the initial product-owned Personal
  Patterns taxonomy. Broader action classification requires separate product
  evidence.
- Do not add a destructive legacy-vault migration. Bounded read-only production
  evidence found no note-history coverage marker or source advertising note
  collection, so ordinary encrypted vault state cannot prove affected rows.
  The completed v1 marker remains a valid durable rollout state, however:
  note-history coverage version 2 therefore performs one bounded semantic
  reimport for each legacy-covered source. Personal Patterns excludes the
  recognizable legacy Junction `tag-*` intervention shape while neutral
  replacements arrive.
- Accepted the preliminary ReviewGPT existing-member finding: keeping the note
  coverage version at 1 would permanently suppress older Oura sauna history for
  a source already marked complete under the legacy normalizer. The v2
  obligation is terminal after one successful bounded pass and requires no
  event rewrite or deletion.
- Accepted the final round-one source-identity finding: Junction provider note
  ids are local to a source instance. Explicit-id note spines therefore include
  source type and source-instance provenance, preserving edit stability without
  letting one same-provider device overwrite another.
- Round two required an anomaly retrospective because the accepted history
  mechanism recurred for v1 jobs in flight across deployment. Decision:
  continue with the existing resource-job payload as the immutable semantic
  generation owner. Unversioned durable work remains v1; all continuations and
  retries preserve the admitted generation; completion cannot infer generation
  from the currently deployed policy. No new queue, manager, migration service,
  repair loop, or lifecycle enum is added.
- Bump the Browser Vault replica generation so existing projections rebuild
  under the corrected factor interpretation.

## Verification

- Focused importer test: passed, 143 tests.
- Focused Personal Patterns and Browser Vault query tests: passed, 42 tests.
- Focused hosted replica-generation test: passed, 1 test.
- Focused vault import-to-Patterns and revision test: passed, 2 tests under the
  default timeout.
- Focused Junction historical-backfill test after ReviewGPT remediation:
  passed, 62 tests; a stored `v1|oura` marker schedules exactly one v2 bounded
  note-history pass and terminal coverage prevents repetition.
- Source-instance collision remediation: focused importer and canonical
  import/replay tests cover two Oura instances sharing one provider-local note
  id; editing or clearing one leaves the other intact.
- Upgrade-fence remediation: focused device-sync tests cover unversioned v1
  continuation across current code, v1 completion remaining v2-eligible, late
  v1 completion preserving v2, future-generation fail-closed behavior, and
  manifest/hosted-hint preservation. Three focused files passed, 178 tests.
- Focused Web changelog tests: passed, 56 tests.
- Contracts, importers, query, vault-usecases, device-syncd,
  hosted-execution, and full Web typechecks: passed.
- Preliminary `completion-specialists` ReviewGPT returned one accepted
  existing-member history finding; no patch artifact was returned. Final
  ReviewGPT round one accepted history and source-identity findings, round two
  required the documented deploy-generation retrospective, and round three
  passed the remediated exact head with no qualifying findings.
- Exact-head GitHub Actions passed. One repo-tool attempt received an unrelated
  GitHub Markdown-rendering 403; rerunning the failed release build/typecheck
  job on the unchanged head passed.
- Remaining at close: current-base merge-tree proof after the docs-only plan
  archive commit.
- Expected outcomes: neutral canonical notes retain tags/provenance but not
  free text; only allowlisted Oura actions appear in Personal Patterns; replay
  and remediation are idempotent; no accepted review finding remains.
Completed: 2026-08-11
