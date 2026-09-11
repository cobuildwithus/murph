# Make automation edits discoverable and long work visible

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make existing automation edits easy to discover and execute correctly, and keep
members informed when an attended request grows into substantial work.

## Success criteria

- Automation declarations retain complete action-specific types, required fields,
  and descriptions through native and code-mode discovery.
- Versioned edits use the authoritative readback version; stale and missing
  versions never overwrite current records.
- Focused real-Codex journeys perform useful edits without invalid calls and send
  one timely progress update for multi-record work, while quick work stays quiet.

## Scope

- In scope: automation CLI discovery/readback, model-facing tool schema and repair
  guidance, progress policy, deterministic tests and focused live journeys.
- Out of scope: production mutations, model changes, new state or retry owners.

## Constraints

- Existing canonical automation records and version checks remain authoritative.
- Use synthetic examples only; never persist production evidence or identifiers.
- Derive schema guidance from the runtime schema instead of maintaining copies.
- Outcome: correct edits with brief, useful progress during longer work.
- Reaches: private attended multi-edit and quick-edit journeys; group guidance
  retains one-update and audience limits, unavailable channels remain unchanged.
- Proof: production-derived schema capture, exact tool effects, final readback,
  and reviewed synthetic live progress/final messages.

## Risks and mitigations

1. Complete schema declarations may increase input size. Measure complete first
   provider inputs for individual and group fixtures and remove obsolete machinery.
2. More proactive progress may add chatter. Preserve quick/no-reply/unavailable
   paths and test both long and short attended work.

## Tasks

1. Trace canonical CLI, runtime schema, code-mode declaration and repair output.
2. Correct schema/discovery and recovery at their existing owners.
3. Tune composed progress guidance; add deterministic and synthetic live proof.
4. Run focused tests, typechecks, input measurement and live journeys.
5. Review the full candidate, document results, close the plan and commit.

## Decisions

- The model schema currently replaces identical action-branch fields with empty
  schemas and removes top-level property descriptions. Code-mode conversion does
  not recombine those fields with their sibling definitions. Test this boundary
  directly before choosing a replacement.
- The operator CLI already reads the stored record before sparse edits; the
  hosted tool separately requires an exact inspected version. Preserve that split.
- Removed the lossy compactor and advertise the canonical runtime document
  directly. The real Codex declaration regression failed on the base and passes
  with the self-contained action branches. The previous canonical JSON supplement
  still contained the requirement; the defect was misleading generated types and
  buried guidance, not a completely absent field.
- Keep version enforcement unchanged. Missing-version validation now explains
  how to inspect, copy the authoritative id/version, and retry the intended edit.
- Progress remains model guidance with existing delivery and audience limits;
  it does not introduce a timer, status polling, or a deadline guarantee.

## Verification

- Focused Assistant Engine schema, runtime validation, prompt and scripted tests.
- Focused CLI automation tests and relevant package typechecks.
- Focused real Codex through `pnpm test:assistant:live`, local subscription, Terra.
- Full initial-provider-input measurements and `pnpm complexity:diff`.
- Expected: version-fenced correct edits, useful progress, concise truthful replies.

## Evidence and parent review

- Passed 129 focused Assistant Engine tests covering schema contracts, validation,
  versioned fixture effects, and composed progress instructions.
- Passed 38 CLI automation tests, including compact readback, pagination, and
  payload reduction. Assistant Engine and CLI typechecks passed.
- Passed the real pinned Codex App Server declaration regression and both
  complete-input captures against a local provider stub. This proves conversion
  without depending on a paid model sample.
- Complete decoded first-request bytes, identical synthetic fixtures at base/head:
  direct 160344 -> 160343 (-1 byte, -0.0006%); group 144286 -> 144432
  (+146 bytes, +0.1012%). Only prompt_cache_key is excluded. An exact Terra
  tokenizer is unavailable, so token counts remain unverified. Automation tool
  registration grows 21881 -> 30905 bytes (+9024), deferred until discovery.
- Passed 10 changelog rendering tests; added one prose-only member improvement
  entry. No renderer changes or visual artifact are needed.
- Complexity guard passed: deleted schema-compaction debt (8 -> 0), with no
  increased existing hotspots. Parent reviewed all changed source and test
  boundaries; existing runtime validation, version ownership, scheduling, and
  delivery authority remain unchanged. No extra awaited owner/network operation
  is introduced; the model may use the existing progress send earlier.
- No final external review is routed for this prompt/tool-discovery usability
  change: it removes model-schema rewriting and adjusts validation copy without
  changing runtime input acceptance, persistence, or authority. No PR, push,
  production mutation, or deployment is part of this task.
- An attempted ESLint command was unavailable because these packages do not
  declare that CLI; package typechecks, focused tests, and the repository's
  complexity guard provide the applicable local checks.
- Documentation drift and gardening checks passed. Task-addition privacy scan
  and whitespace/diff checks passed.
- First live single-edit sample performed exactly one inspect and one valid patch
  without progress, but its confirmation omitted the requested new wording. The
  test caught that omission; production tool guidance now asks for the new wording
  in the confirmation. The four-edit sample delivered one early progress update
  followed by exactly four inspect/patch pairs, without invalid calls.

## Final outcome

- Product UX: Ready. Both final real-Codex journeys pass on gpt-5.6-terra with
  low reasoning and local subscription authentication, using synthetic ports.
  The initial home and two alternate homes failed before provider action; the
  next working profile was retained for every behavioral run.
- `pnpm test:assistant:live -- --test 'quick single edit'`: one inspection, one
  valid patch, zero progress updates, and a clear confirmation of the new wording
  and preserved schedule.
- `pnpm test:assistant:live -- --test 'several edits.*uses inspected versions'`:
  one useful progress update before editing, four inspections, four valid patches,
  no invalid attempts or duplicate writes, and a concise truthful confirmation.
- Read every final synthetic reply and progress message. Both fulfill the request
  without internal implementation language or unnecessary questions. Group limits
  and unavailable-route behavior have deterministic prompt coverage; these two
  paid journeys cover the materially different direct quick/long cases.
- After the confirmation refinement, the 129 focused tests, package typecheck,
  real App Server regression, and complete first-input measurements passed again.
  Final parent review and task-addition privacy review passed. The implementation
  is ready as a scoped local commit; it has not been deployed or submitted to CI.
Completed: 2026-09-10
