# Preserve game block recovery and reviewer readiness

Status: completed
Created: 2026-10-27
Updated: 2026-10-27

## Goal

- Preserve access to a player's own block controls during invite-only rollout,
  and refuse reviewer fixture reseeding when a pair block would hide its games.

## Success criteria

- HTTP/Postgres proof covers both a joined player and an invite holder who
  blocks before joining, without granting fresh-game creation or bypassing off.
- Reviewer dry-run and apply refuse blocks in either direction, preserving rows.
- Focused tests, web typecheck, parent review, required CI and final review pass.

## Scope

- In scope: existing HTTP admission and reviewer readiness owners and tests.
- Out of scope: automatic unblocking, production consent, rollout flag changes.

## Constraints

- Reuse canonical GameBlock rows, bounded existence queries and pair and member locks.
- Preserve game-level authorization, global disable and private fixture data.

## Risks and mitigations

1. Admission accidentally grants game creation. Prove per-command refusal.
2. A block races fixture preparation. Recheck under existing pair and member locks.

## Tasks

1. Reproduce unreachable recovery with composed HTTP tests.
2. Extend admission for owners of outgoing blocks; retain command gates.
3. Inspect and revalidate reviewer pair blocks without clearing them.
4. Verify, document, review and integrate the scoped patch.

## Decisions

- Product UX patch: Outcome is reachable unblock controls. Reaches unlisted
  joined players and invite-only recipients. Proof follows HTTP block, Home,
  unblock, stranger rejection, creation rejection and global-disable behavior.

## Verification

- Focused game API and reviewer seed Postgres tests on an isolated local DB.
- Web typecheck, complexity diff and focused route tests.
- Expected: all checks pass; no production writes or messages in verification.

## Candidate evidence

- Product UX: Ready. Both invite-only paths block, list and unblock over HTTP;
  fresh-game creation, strangers and global-off remain refused.
- Focused routes and Postgres: 71 tests passed, including both block directions
  and a block arriving during photo preparation. Changelog rendering: 4 passed.
- Web typecheck passed. Complexity guard passed with no hotspots above 20.
- Parent review: reused pair locking and blocked-pair reads; no new state or
  dependencies. No production writes, messages, reviewer credentials or flags.
- Final ReviewGPT round 1 PASS at 44355b644fce99271be9b3d6d704903c0a305b37.
  GPT-6 Pro, full snapshot, exact checked head and completion marker verified;
  the tool enforced its 180-second minimum. Parent accepted with no findings.
  The first lane failed before send; the configured Vonneumann lane completed.
- Final parent review: admission remains authenticated and globally gated;
  commands retain creation/view/media authority. Pair locking serializes reseed
  with block, and existing rows survive a refusal. No further code changes.
- CI on the reviewed code is green except still-running package coverage and
  billing jobs; final documentation head and merge remain completion gates.
Completed: 2026-10-27
