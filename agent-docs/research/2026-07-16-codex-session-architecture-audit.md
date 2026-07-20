# 2026-07-16 Codex Session Architecture Audit

Status: point-in-time research note
Updated: 2026-07-18
Window: 2026-06-16 06:41:37 UTC through 2026-07-16 06:41:37 UTC, inclusive

## Purpose

This audit examined the frozen local Codex session corpus for the 30-day window,
related session evidence to a point-in-time Git and GitHub snapshot, and measured
recurring architecture steering. Its durable outcome is the decision sequence
in `agent-docs/ARCHITECTURE_GUIDANCE.md`.

This note records aggregate evidence and limitations. It is not a transcript,
an attribution record, or a live statement about current branches and pull
requests.

## Privacy Boundary

The tracked repository contains no transcript text, session or message aliases,
local paths, account identifiers, branch or worktree names, commit identifiers,
pull-request numbers, raw repository paths, credentials, or reversible
redaction map from this audit.

The detailed corpus, provenance, change snapshot, joins, summaries, and steering
queue remain local-only under the ignored `.codex-audit/` tree with private file
permissions. Only fixed enums, aggregate counts, and generalized principles are
recorded here.

## Method

1. Freeze every selected source at an exact byte or transaction boundary and
   keep newly discovered post-launch sources outside the generation.
2. Reconcile rollout copies, archives, SQLite state, global history, session
   lineage, and direct-user message identity. Preserve degraded history evidence
   without treating it as canonical steering.
3. Freeze local refs, worktrees, reflogs, reachable commits, and a terminal
   GitHub pull-request set. Authenticate all generated artifacts before use.
4. Map only structured repository-qualified evidence. Created, modified,
   pushed, merged, reviewed, and literal references can support mappings.
   Read-only observations and session-start context remain audit-only.
5. Treat branch, path, and worktree evidence as bounded candidates, never exact
   proof. Do not infer mappings from timestamps, similar patches, or co-location.
6. Support `why` only with a preceding canonical root-session task instruction.
   Leave motivation unknown when that evidence is absent.
7. Rank only complete canonical root messages eligible for steering evidence.
   Promote a topic only after at least two candidates across at least two
   sessions, then reconcile the generalized principle with current durable
   repository contracts.

## Corpus Coverage

| Measure | Count |
| --- | ---: |
| Selected local profiles | 10 |
| Frozen sources | 11,427 |
| Regular rollout sources | 11,337 |
| Archived rollout sources | 71 |
| SQLite sources | 10 |
| Global-history sources | 9 |
| Sessions with evidence | 8,189 |
| Rollout-backed sessions | 8,168 |
| History-only sessions | 21 |
| Confirmed direct-user messages | 9,561 |
| Degraded transcript messages retained for context | 5,146 |
| Sources discovered after the launch boundary and excluded | 1,261 |
| Blocking diagnostics | 0 |

The excluded post-launch sources preserve point-in-time reproducibility; they
are not silent drops from the frozen cohort. The 21 history-only sessions and
all degraded transcript messages remain available as context but do not supply
canonical steering or motivation.

## Frozen Change Snapshot

| Evidence set | Count |
| --- | ---: |
| Commits | 8,518 |
| Commit/path relations | 167,063 |
| Commit/ref containment relations | 1,845,994 |
| Pull requests selected | 558 |
| Pull requests scanned to establish the terminal set | 780 |
| Selected pull-request commits | 4,852 |
| Pull-request commits scanned | 5,911 |
| Pull-request paths | 13,291 |
| Refs | 1,582 |
| Worktrees | 155 |
| Reflog entries | 11,610 |
| Reflog commit roots | 6,325 |

The snapshot was complete and internally authenticated. It is a historical
boundary, not a claim about repository state after capture.

## Session-to-Change Results

Every session received one explicit disposition:

| Disposition | Sessions |
| --- | ---: |
| Mapped | 56 |
| Mapped with an unresolved secondary reference | 26 |
| Candidate review only | 95 |
| Resolved child context only | 6,417 |
| Degraded root context only | 1,590 |
| No change reference | 4 |
| Reference absent from the frozen snapshot | 1 |

The mapper retained 2,718,671 read-only anchor observations as audit counts
rather than presenting them as work performed. Branch and path evidence was
also bounded: 157,983 branch candidates and 27,748 path candidates were emitted
after deterministic nearest-candidate caps. These remain low-confidence review
candidates and never establish motivation.

The compact summary stage produced 17,265 records. At the session level, 1,141
records had mapped build context, 6,873 were candidate-only, and 175 were
unknown. Motivation was supported for 274 sessions and unknown for 7,915. At
the frozen-change level, 116 of 9,076 commit or pull-request records had a
supported `why`; 8,960 remained unknown. Unknown is the intended result when a
preceding canonical task instruction cannot be proven.

## Steering Results

The ranker retained 75 candidates. Forty-seven contributed to a recurring
principle and 28 were excluded as task-local or unclassified. Topic counts can
overlap because one correction may express more than one concern.

| Promoted topic | Candidates | Sessions |
| --- | ---: | ---: |
| Verification and proof | 28 | 26 |
| Planning and scope | 24 | 22 |
| Durability and failure | 22 | 20 |
| Product outcome | 19 | 18 |
| Deployment and compatibility | 18 | 17 |
| Privacy and authority | 18 | 17 |
| Root cause before fix | 18 | 17 |
| Explicit data flow | 16 | 14 |
| Critical-flow preservation | 12 | 11 |
| Simplicity and deletion | 7 | 6 |
| Ownership and state | 4 | 3 |

The strongest cross-cutting pattern is architecture-first planning: define the
outcome and invariant, locate the current owner, trace the data and authority
flow, prove the actual gap, choose the smallest durable correction, design
failure and deployment behavior, and name the proof before implementation.

## Durable Outcome

The recurring themes map to the evergreen guide without duplicating existing
owners:

| Evidence themes | Guide location |
| --- | --- |
| Product outcome; planning and scope; critical-flow preservation | Outcome and protected invariant |
| Ownership and state; explicit data flow; privacy and authority | Current owner and data trace |
| Root cause before fix | Actual-gap proof |
| Simplicity and deletion | Smallest durable correction |
| Durability and failure; deployment and compatibility | Failure and evolution design |
| Verification and proof | Proof plan |

`AGENTS.md` routes repository work through the guide before code inspection and
planning. The guide links to the canonical architecture, invariant, product,
security, reliability, workflow, and verification documents instead of
restating their detailed rules.

## Confidence and Limits

- Coverage is complete for the frozen source and change boundaries, with zero
  blocking diagnostics. It does not include sources created after launch.
- Exact mapping requires structured direct evidence. Candidate evidence is
  intentionally truncated and must not be reported as an exact change link.
- Child and degraded sessions dominate the corpus and are context-only by
  design. They cannot supply canonical motivation or steering.
- A topic enum records a lexical signal, not semantic agreement. Recurrence can
  overmatch, and this audit did not infer contradictions from enum-only
  evidence. Only recurring themes already corroborated by current durable
  repository rules entered the evergreen guide.
- Co-occurrence does not prove that two instructions had the same scope.
  Task-local and unclassified candidates were excluded rather than generalized.
- `Why` coverage is deliberately sparse. No generic template or nearby
  unrelated message was substituted when direct motivation evidence was absent.
- The detailed private evidence is required to reproduce individual mappings;
  this tracked note is sufficient only for aggregate review and the generalized
  architecture guidance.
