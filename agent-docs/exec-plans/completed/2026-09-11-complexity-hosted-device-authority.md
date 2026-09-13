# Simplify hosted device runtime apply derivation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Simplify canonical hosted device runtime apply without changing authorization, token versions, source ownership, or persistence results.

## Success criteria

- Remove identity-only credential helpers and duplicated token derivation; replace correlated persistence flags with a typed credential plan.
- Reduce callback complexity and file debt while focused authority/route, bounded PostgreSQL, typecheck, and guard proof passes.

## Scope

- In scope: private derivation and source-admission helpers in hosted-runtime-authority, focused regression proof.
- Out of scope: authentication policy, persistence schemas, provider I/O, runtime protocols, source lifecycle semantics, or additional database queries.

## Constraints

- Technical constraints: preserve pre-BEGIN secret preparation, every live secret/root/connection/token/source epoch fence, one transaction at a time, and existing write/notice ordering.
- Product/process constraints: Web remains the canonical control owner; no persisted state or public behavior changes.

## Risks and mitigations

1. A refactor could conflate missing, clear, and unchanged credentials or bypass live authority. Keep validation and fencing in place and prove token clear/replacement/no-op, authority drift, and maximum-cardinality composition through public owners.

## Tasks

1. Trace preparation, lock admission, pure derivation, persistence, and notices.
2. Remove redundant helpers and consolidate credential and patch derivation without moving I/O or fences.
3. Run focused authority/route and PostgreSQL cardinality proof, Web typecheck, and complexity guard.
4. Review privacy and full diff, close implementation plan, commit/push a draft PR for parent-owned final review.

## Decisions

- Existing canonical connection/source/token records remain authoritative. A credential plan exists only within one callback and cannot authorize persistence independently of the existing live fences.
- Private derivation helpers reuse existing token-version, metadata, lifecycle, and source comparison owners; no framework or package boundary is added.

## Verification

- Commands: focused hosted runtime authority and internal apply route tests; two isolated real-PostgreSQL maximum-cardinality apply cases; hosted-web typecheck; complexity diff.
- Expected outcomes: equivalent public results and transaction counts, no external work in locked transactions, lower cyclomatic debt. Parent owns exact-head CI and ReviewGPT completion.

## Implementation evidence

- Authority and internal apply route suites: 90 tests passed, including five new cases covering current/pending/absent Google source authority and dirty-work blocking of Fitbit terminal projection.
- Isolated real-PostgreSQL proof: both the 100-update no-op apply with concurrent foreground reads and the maximum Junction source-collection apply passed; six unrelated incident cases were excluded. The task database applied all 221 current migrations before testing.
- Existing authority tests also prove 100 token preparations occur outside BEGIN and 100-by-64 source updates remain bounded to 6,400 serial source writes.
- Hosted Web typecheck and diff whitespace checks passed. The full typecheck initially caught a grouped setup-phase enum assignment; preserving its dedicated assignment resolved it, and the final prepared Web check passed.
- Complexity guard passed: callback 113 to 73; file debt 136 to 96. All added helpers remain at or below 20. The unchanged source-update resolver (44) and snapshot reader (39) are independent seams.
- Removed two redundant credential helpers, shared token derivation, replaced correlated persistence flags, and grouped optional patch fields. Fitbit terminal source classification now computes successor presence once and reuses the selected set for dirty filtering.
- Full diff review preserved every live authority fence, SQL call and serial transaction, credential validation order, prepared-token match assertion, and post-commit notice scheduling.
- Implementation is complete; parent owns candidate review, Ready transition, final ReviewGPT, and exact-head CI.
Completed: 2026-09-11
