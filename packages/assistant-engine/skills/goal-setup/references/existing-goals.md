# Existing goals: reuse, change, pause, resume

Read this when the goal list shows a Goal that may be the same outcome, when
the member asks to pause or resume, or when they change a plan already saved.
The aim is one Goal and one habit regimen per outcome, never a second copy.

## Is it the same goal?

Read each plausible match with `vault-cli goal show <goal-id> --format json`.
The same `commonsGoalRef.key` is the strongest sign. Without it, require the
same concrete outcome. A new event or a new target is a new goal. If you still
cannot tell, ask one short question; never merge two goals on a guess.

- **Active:** find its regimen (below) and continue with that Goal and plan.
- **Paused:** reuse the same Goal and plan; resume it as described below.
- **Completed or abandoned:** treat it as history. Do not reactivate it,
  duplicate it, or rewrite it without the member asking. Offer a new goal.

A public goal page changing never rewrites a member's saved Goal or plan.
`commonsGoalRef` records where a plan came from; the plan itself lives in the
regimen.

## Find the regimen

```text
vault-cli regimen list --limit 200 --format json
vault-cli regimen show <plausible-regimen-id> --format json
```

Match on `kind=habit` and `relatedGoalIds` containing the Goal id. None: create
one. One: reuse it, even when paused, by adding `--id <regimen-id>` to the
`regimen save` in SKILL.md. More than one: write nothing and ask the member
which plan is current. This list has no next page, so a result of exactly 200
may be cut off: write nothing and say so.

## Current reminders

Before saving, changing, or removing reminders on an existing regimen, list
them all:

```text
vault-cli automation list --support-series-id habit:<regimen-id> --compact --limit 200
```

Follow each `nextCursor` with `--cursor` until it is null. If you cannot get the
full list, change nothing. Then patch the reminders that already match, save
only the missing ones, and `reconcile` the series to exactly the ids that
should remain. For a plan with no reminders, reconcile to an empty list (not
needed when the list is already empty). If the Goal, regimen, and reminders
already match what the member accepted, write nothing.

## Change a saved plan

Offer the change and wait for a clear yes, as in SKILL.md. Then save with
`--id <goal-id>`; keep the stored title unless the member accepted a rename,
and for a public goal pass the same three Commons flags with the values from a
fresh `show`. A status-only save needs no title or Commons flags.

## Pause or resume

Asking to pause or resume is the authorization; no offer is needed.

```text
vault-cli goal save --id <goal-id> --status <paused|active> --format json
vault-cli regimen save "<stored-title>" --id <regimen-id> --kind habit --status <paused|active> --format json
```

Keep every other field as stored. A Goal with no regimen changes only the Goal.

- **Pause:** list the reminders, reconcile the series to an empty list, pause
  the regimen, then the Goal.
- **Resume:** check the plan still fits. If the plan or reminders need to
  change, offer the new version and wait for a yes. Then activate the regimen,
  then the Goal, then save only the reminders the member accepted.

If one step fails, read the Goal and regimen back and tell the member the exact
state. Do not retry by creating a copy.
