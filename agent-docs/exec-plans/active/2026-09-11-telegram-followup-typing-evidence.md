# Telegram follow-up typing evidence

Status: active
Created: 2026-09-11

## Outcome and invariant

Resume PR #3252 at `6b5f6a3207a2c9d2dac0b6d5c1df222b35d3044f` after the
user accepted the round-2 remediation handoff. Telegram inputs imported during
an active typing session must inherit acceptance for their exact target and
input. Preserve provider calls, asynchronous telemetry, and store scoping.

## Cause and smallest correction

The engine starts typing once per turn. The importer already inherits Linq
acceptance, but Telegram has no equivalent observation. Extend channel-activity's
ephemeral typing evidence and its import handoff; retire observations on stop
and abort. The existing trace and alert ledger remain the durable owners.
No schema, provider policy, prompt, or delivery behavior changes are needed.

## Proof and completion

1. Reproduce the missing milestone through the real Telegram provider wrapper
   and mailbox importer with synthetic HTTP, including later active-turn input.
2. Cover unrelated targets, stop, abort, failed starts, and overlapping handles.
   Keep existing slow/missing acceptance and deduplication SQL proof.
3. Run focused runtime tests, runtime typecheck, complexity and documentation
   guards. Review privacy, lifetime ownership, and unchanged provider calls.
4. Commit and push, mark Ready, and run substantive ReviewGPT round 3 in the
   existing Hercules conversation alongside exact-head CI. Follow finding
   disposition and the three-round cap; merging and deployment are separate.

## Progress

- PR head, clean owning worktree, handoff, and round-2 evidence match.
- The new composed regression failed before the fix: only the first Telegram
  input had acceptance. After remediation, all 192 focused channel/import/workspace
  tests pass; the final nullable-conversation test guard was rechecked in the five
  focused follow-up scenarios.
- Real PostgreSQL alert proof: 4 passed, including inherited pre-receipt Telegram
  acceptance, genuine missing/slow evidence, immutable retries and deduplication.
- Runtime and Web typechecks, complexity guard, docs drift and diff checks pass.
  Existing complexity hotspots are unchanged. Parent candidate review found no
  further issue; provider calls and telemetry scheduling remain unchanged.
- Internal-only change: no changelog or live model journey applies because no
  prompt, tool, reply, or provider-input behavior changed.
- Round 3 and exact-head CI remain pending on the next pushed candidate.
