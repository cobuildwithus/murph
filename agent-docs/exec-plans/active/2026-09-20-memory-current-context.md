# Useful current memory and automatic maintenance

## Outcome and invariants

Private conversations should apply established preferences and learned ways of
helping without an explicit recall request. Existing scheduled maintenance
should improve legacy records automatically after deployment. Keep canonical
memory in `bank/memory.md`, retain exact-id optimistic concurrency, preserve
current-input precedence and group isolation, and never derive authority from
memory. Structured health owners remain unchanged.

## Evidence and design

The current injected view stops at three records per section and stops a whole
section at a 200-byte record. This hides older useful preferences and modestly
long corrections. Replace record-count limits with bounded section byte budgets,
reserving more space for Preferences and Instructions. Keep complete records
and newest-first prefix selection so an omitted correction cannot expose older
contradictory facts. No model, network call, or extra read enters the reply path.

Use the existing maintenance tool and canonical update/forget operations to
shorten verbose existing records without changing meaning; learn explicit
conditional assistance preferences; apply current corrections; and forget only
unambiguously ended temporary non-health Context facts. Never infer expiry from
age or absence. Existing records can justify only faithful compaction or their
own explicit expiry, not new facts or inferred traits. New facts still require
conversation evidence. An empty conversation window still admits maintenance
when canonical memory exists, allowing inactive members' old records to improve.
No new schema, store, vector index, summary cache, or migration is needed.

The existing managed automation reconciliation updates the same stable id and
instructions on runtime startup. Preserve the Mon/Wed/Fri 03:00 local schedule,
paused state, silent output, and error/cancellation behavior. Old/new runtimes
read the same memory format; deploying the new runner enables the policy.

## Product UX

- Effort: Product change.
- Entry: An ordinary private request or the next existing maintenance occurrence.
- Journeys: older preference amid newer records; verbose correction; explicit
  procedural preference; expired vs ambiguous temporary context; no recent
  messages with legacy memory; empty vault; newer concurrent edit; group isolation.
- Proof: deterministic selection/admission/reconciliation tests, real-Codex
  maintenance then a fresh private turn using persisted memory, existing
  authority/precedence regression, focused typecheck, complete-input measurement.
- Done when: useful contextual replies with no memory preamble, exact canonical
  changes and silent maintenance, no stale overwrite, no new operator migration.

## Progress

- Planning: source gaps and existing automatic reconciliation confirmed.
- Implementation: section byte budgets, automatic legacy compaction/expiry,
  procedural learning guidance, empty-window admission, and seed refresh complete.
- Deterministic evidence: 292 focused assistant tests pass across selection,
  tools, admission, planning, evidence, and managed automation (the empty-evidence
  assertion was rerun after its updated policy). Assistant and Web typechecks
  pass; ten changelog rendering tests pass. Complexity debt is unchanged.
- Complete first-request capture: private 138187 -> 138830 normalized bytes
  (+643); group 118169 -> 118169, normalized requests identical. Proxy token
  counts with gpt-tokenizer 3.4.0/o200k_base: private 29562 -> 29686 (+124,
  +0.419%), group 25688 -> 25688. Exact Terra tokenization is unavailable;
  these are proxy estimates, not provider billing counts. Includes native Codex
  instructions, tools, skills, and environment messages; generated identities,
  installation IDs, temp paths, and start time normalized; transport-only fields
  excluded by the scripted capture. Eight-preference identical fixture at base
  a32e29827edf and candidate; all eight vs three appear in private context.
- Real-model journey: pending. Default local subscription and early alternate
  homes fail before provider action; continuing the authorized bounded fallback.
- Existing Frog entries cover the documented changelog cwd/generated-input
  workaround; no new friction entry created.
- PR, exact-head CI, and final review: pending.
