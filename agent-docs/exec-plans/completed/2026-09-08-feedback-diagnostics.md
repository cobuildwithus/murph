# Feedback diagnostics and operator-funded execution

Status: completed
Created: 2026-09-08
Updated: 2026-09-09

## Outcome

Ops can read de-identified feedback, request a read-only diagnostic by feedback
id, and read a de-identified answer without selecting or exposing a member.
Existing operator tasks own status, retry, expiry, and encrypted results.
All operator tasks use GPT-5.6 Sol without member allowance or credit deductions.

## Scope and decisions

- One nullable feedback relation on operator tasks; no new queue or worker.
- Bounded Ops-authenticated reads and submissions. Existing private linkage
  selects the workspace; unlinked feedback remains available for code triage.
- Diagnostic instructions require technical evidence and synthetic reproduction
  without private source content. The existing feedback sanitizer runs on output.
- Usage carries task identity; Web verifies task binding before excluding costs
  from member allowance. Provider tokens and costs remain observable.
- Existing account access, consent, delivery, result retention, and provider
  admission boundaries remain. No production scheduling or deployment in this task.

## Product UX and verification

Linked feedback supports follow-up questions through normal idempotent tasks.
Unlinked reports return an explicit unavailable-target result. Delayed, failed,
and expired tasks retain their existing status. Private diagnostic output never
appears on the feedback read surface. Local agents use existing Ops auth.

Test admission/replay, cross-member rejection, de-identification, Sol selection,
zero operator allowance drawdown, and unchanged ordinary member accounting.
Run focused tests/typechecks and a production-derived synthetic live diagnostic.
Review privacy and complexity, update owners, and create a scoped commit.

## Progress

Implementation complete. Focused Web, hosted-execution, assistant-engine and
assistant-runtime tests pass. Local PostgreSQL temporary-table proof verifies
migration nullability, reference enforcement and cascade behavior. The live Sol
subscription journey passes with one provider request, useful synthetic
reproduction, no private identifiers, and unchanged canonical state. Parent
review of the printed diagnostic: Ready. Initial local auth failures happened
before provider work; the permitted alternate-home retry supplied live proof.

Complexity guard passes with no increased existing hotspot debt. Typechecks
cover Web and the three affected packages. ReviewGPT round 1 passed at
`90cdf2ba13e9c35b466f3d154db4e312b7dc886d`;
the captured response hash and actual GPT-6 Pro model metadata match. No
qualifying findings remain. CI exposed one missing migration inventory entry;
that isolated test correction passes all ten inventory checks and Web typecheck.
No production source changed after review. Final-head CI remains the PR gate.
No production mutation or scheduling performed.

Changelog: not applicable; this is internal Ops diagnostic access and operator
cost attribution, with no new member-facing surface or action.

Known limits: results retain existing two-day expiry; unlinked feedback has no
runtime target; exhausted allowance still blocks provider access. Local cron
consumers need existing Ops authentication. De-identification remains a model
contract plus deterministic scrubbing, not a semantic anonymity guarantee.

PR: https://github.com/cobuildwithus/murph/pull/3083
Completed: 2026-09-09
