# Remove meal-name repair execution

Status: active
Created: 2026-11-03
Updated: 2026-11-03

## Goal and invariants

Remove operator repair admission, execution and billing. Preserve normal meal
naming/features, historical usage accounting, vault portability, and mailbox
progress during independent Web/runner deployments. Leave remaining names alone.

## Ownership and evidence

The deleted Ops route/CLI submitted the shared encrypted member action. The
runtime repair executor owned model proposals, canonical revision writes, a
portable progress file and the sole meal_name_repair usage producer. Remove
those owners instead of migrating data or adding a replacement job.

Retain only legacy wire decoding, a deterministic unchanged outcome and the
portable descriptor tombstone. Pending requests and recording receipts can live
in assistant system-mailbox snapshots; request/outcome rows live in Postgres's
existing encrypted mailbox. Progress lives under the retired runtime subtree.
The existing usage ledger's text feature key and generic readers need no changes.

## Product UX

Effort: Patch. Outcome: no operator-driven renaming or new repair charges.
Reaches: operators lose the endpoint/CLI; members retain existing meal data and
usage history. Old queued requests drain quietly, without member messages.
Proof: composed checkpoint/restart test, legacy receipt decoding, portable
snapshot classification, normal naming/action regressions. No presentation or
current assistant prompt/tool change; the removed proposal has no remaining caller.

## Delivery and failure

Deploy Web first; old runner callbacks remain readable. Then converge the native
runner and verify signed smoke. New runners drain old requests without work or
usage; checkpoint/outcome failures retain ordinary retry ownership. No repair
will be run. Do not roll back to an executor that can resume retained work.

## Tasks

1. Delete repair-only source, tests and operator instructions; retain minimal tombstones.
2. Prove legacy requests/receipts, progress portability and normal meal behavior.
3. Run focused tests, relevant typechecks, complexity and parent diff review.
4. Push draft PR, mark ready, run ReviewGPT on vonneumann (apollo if busy) with CI.
5. Resolve review, close plan, merge exact head and deploy Web then runner.
6. Write private final report with merge/deployment evidence and residual risks.

## Verification

Passed: contracts member-action/meal-name (40 tests), runtime restored repair
pending/sending/recording (3), runtime-state versioned state (12) and snapshot
inventory (9), Web mini-app (18), outcome/mailbox/companion Meals boundaries (44),
and engine assistant-ask (17). Relevant contracts, runtime-state, engine, runtime
and Web typechecks pass. Complexity guard passes; executeHostedSystemWake remains
an unchanged 39-complexity dispatcher with repair dependency construction removed.
Docs drift and whitespace checks pass. Parent candidate review: Ready.

No live model run is needed: current prompts/tools and ordinary individual/group
provider inputs are unchanged, and retired work is proved provider-free through
its real deterministic checkpoint owner. No public changelog: internal operator
maintenance retirement, with no new member surface or change to historical costs.
CI, ReviewGPT and production deployment remain required before task completion.

## Workspace

The supplied checkout failed the storage authorization guard. Preserve it;
implementation uses a sanctioned checkout created from the same branch.
