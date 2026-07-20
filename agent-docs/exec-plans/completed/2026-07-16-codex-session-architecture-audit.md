# Audit recent Codex sessions and derive architecture guidance

Status: completed
Created: 2026-07-16
Updated: 2026-07-18

## Goal

- Audit every locally available Codex session with direct activity in the rolling
  30-day window, recover a redacted-complete transcript of the user's messages,
  map each session to the change it produced and its commits or pull requests,
  and turn repeated architecture steering into concise guidance that Codex reads
  before planning repository changes.

## Success criteria

- Every known local Codex profile, rollout store, archive, state index, and
  history fallback has a recorded, timestamped disposition for the frozen audit
  window. Migrated copies, forks, spawned children, malformed records, and
  history-only sessions are reconciled or reported explicitly.
- The ignored private evidence bundle contains one chronological,
  redacted-complete entry for every confirmed direct-user message in every
  eligible root session. It preserves ordering and source locators without
  copying secrets, direct identifiers, private paths, or attachments.
- Every eligible logical session has a summary of what was built and why, plus
  zero or more evidence-ranked commit and pull-request relations. Ambiguous or
  absent mappings remain explicit instead of being guessed.
- Every architecture-relevant user correction has a disposition: promoted,
  merged, retained as contextual, excluded as task-local, marked superseded, or
  flagged for unresolved contradiction. Promoted principles have recurrence,
  scope, contradiction, and adoption evidence.
- A redacted point-in-time research note records corpus coverage, aggregate
  change mappings, steering themes, confidence, and gaps. A separate evergreen
  architecture guide converts supported themes into a short pre-implementation
  decision procedure without embedding transcript text or session identifiers.
- `AGENTS.md` routes pre-implementation work to the guide, `agent-docs/index.md`
  indexes the live guide, and no product/runtime behavior changes.
- Metadata-only verification proves source/message reconciliation, private
  permissions, ignore/deploy exclusion, redaction, deterministic output, doc
  references, and the final tracked diff.

## Scope

- In scope: local Codex profiles and archives; rollout, SQLite, session-index,
  and history evidence; direct-user transcript recovery; session/change/PR and
  commit mapping; steering-event mining; redacted research and architecture
  guidance; routing/index updates.
- Out of scope: changing original Codex state; uploading transcripts or review
  bundles; treating spawned-agent task prompts as user speech; reproducing
  forbidden sensitive values byte-for-byte; changing Murph product/runtime
  behavior; making uncertain session/change associations appear authoritative.

## Constraints

- Technical constraints: freeze source byte boundaries and Git/GitHub snapshots;
  select by record time rather than file mtime; reconcile divergent profile
  copies event-by-event; retain history-only evidence with degraded confidence;
  stream through redaction without an unredacted staging file; keep private
  artifacts under the ignored `.codex-audit/` tree with restrictive permissions.
- Product/process constraints: preserve unrelated checkout and ledger work; use
  an isolated worktree; keep current architecture owners and immutable completed
  plans unchanged; promote repeated, current steering rather than isolated task
  instructions; commit only redacted generalized documentation.

## Risks and mitigations

1. Risk: migrated copies, resumed forks, compaction, or spawned-agent inheritance
   inflate message and steering counts.
   Mitigation: canonicalize by logical lineage and event identity, preserve
   intentional repeated corrections, and require per-session count reconciliation.
2. Risk: user-role records include platform context or agent delegation rather
   than direct human input.
   Mitigation: classify provenance from record type, thread lineage, bootstrap
   position, and mirrors; leave ambiguous records unresolved and fail coverage
   closed instead of silently including or dropping them.
3. Risk: transcripts contain secrets, personal identifiers, health details, or
   private filesystem paths.
   Mitigation: redact before every write, store no reversible redaction map, use
   neutral aliases, restrict permissions, and scan without printing matches.
4. Risk: live repository refs or PR state move during a large audit.
   Mitigation: freeze local ref tips, source byte sizes, and GitHub API pages with
   capture timestamps; associate changes only against that snapshot.
5. Risk: one-off steering is overgeneralized into a permanent architecture rule.
   Mitigation: require directness, recurrence, consistency, adoption, scope, and
   counterexample checks; keep task-local or contradictory evidence out of the
   evergreen guide.

## Tasks

1. Freeze and inventory every local Codex source and the exact rolling window;
   reconcile rollout, archive, SQLite, session-index, and history coverage.
2. Build the ignored private evidence bundle by canonicalizing lineages and
   extracting every confirmed direct-user message through streaming redaction.
3. Freeze repository refs and GitHub PR metadata, then map session tool evidence,
   branches, commits, patches, paths, and plans to commits and PRs with explicit
   confidence and ambiguity.
4. Summarize what each session built and why, then extract and adjudicate all
   architecture-relevant steering and plan-correction events.
5. Write the redacted point-in-time audit and the compact evergreen architecture
   decision guide; add only the necessary read-first and index routes.
6. Run corpus reconciliation, privacy, permissions, determinism, doc readback,
   reference, scope, and final-diff checks; fix any evidence-backed gaps.
7. Close the plan and create the required scoped commit with `scripts/finish-task`.

## Decisions

- Keep the full recovered transcript and detailed provenance local-only under
  `.codex-audit/architecture-mining/2026-07-16/`; commit no raw session content.
- Use `event_msg/user_message` plus root-thread lineage as the primary direct-user
  carrier. Use response mirrors and `history.jsonl` only for reconciliation or a
  clearly labeled degraded fallback.
- Use neutral aliases for sessions and sources. Preserve exact commit SHAs and PR
  numbers because they are necessary non-personal change provenance.
- Store point-in-time evidence in
  `agent-docs/research/2026-07-16-codex-session-architecture-audit.md` and live
  guidance in `agent-docs/ARCHITECTURE_GUIDANCE.md`.
- Make the live guide a decision sequence and architecture-first planning
  contract. Link to existing owners rather than duplicating current topology,
  workflow commands, product rules, or verification policy.
- Keep read-only tool observations and session-start metadata as audit counts,
  not change mappings. Treat branch, path, and worktree relations as bounded
  candidates; preserve exact created, modified, pushed, merged, reviewed, and
  literal references as mapping evidence.
- Leave motivation unknown unless a preceding canonical root task instruction
  proves it. Do not fill evidence gaps with generic task summaries.

## Verification

- Private collector/verifier: all declared sources readable or explicitly
  failed; every eligible session and confirmed human message reconciled; no
  unresolved silent drops; deterministic redacted-corpus hash; private modes;
  ignored and deploy-excluded output; forbidden-pattern scan returns zero.
- Frozen mapping verifier: every recorded commit/PR relation resolves in the
  captured snapshot and includes its evidence basis and confidence; all sessions
  have an explicit mapped, unmapped, context-only, or degraded disposition.
- Tracked docs: full readback, intended-deletion confirmation, broken-reference
  search, `git diff --check`, identifier/secret/path scan, and parent full-diff
  review. Run the exact docs/process lane required by
  `agent-docs/operations/verification-and-runtime.md` for the final change shape.
Completed: 2026-07-18
