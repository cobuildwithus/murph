# PR 528 ReviewGPT CI round 3 remediation

## Goal

Close the accepted exact-head ReviewGPT findings without adding a second route
repair owner or interrupting admitted Linq conversations during rollout.

Success criteria:

- Proof-bearing Linq inputs remain in the existing pending index until canonical
  route repair succeeds, including terminal and auto-reply-disabled inputs.
- Route repair runs in a fixed-size background batch and yields to fresh input;
  cron cannot overtake a retained proof backlog.
- A default-off web producer gate defers only the A-to-B home mutation while
  continuing to admit the inbound message until the new consumer is verified.
- Focused tests, affected typechecks, completion audits, exact-head CI, and
  ReviewGPT pass.

## Evidence

- Normal pending-index compaction currently removes terminal inputs before the
  next background repair pass, including from idle and snapshot maintenance.
- The importer enqueues only auto-reply-eligible inputs, so a direct Linq route
  transition can be omitted from the sole durable repair owner.
- Background automation currently scans the complete raw pending index before
  its one-input bounded selection and has no yield point inside that scan.
- The web producer can deploy automatically from `main` before the manually
  rolled Cloudflare consumer, and the old parser silently drops the new former
  home field.

## Approach

1. Extend the existing pending-index state with an exact route-proof subset;
   enqueue proof-bearing direct Linq inputs even when auto reply is disabled.
2. Preserve those IDs during ordinary compaction. Process one fixed-size batch
   through the existing canonical repair owner, then remove only successfully
   repaired proof IDs under the pending-index lock.
3. Replace whole-index repair scans with that bounded consumer and recheck the
   caller defer predicate after the pre-cron hook so late proof cannot be
   overtaken.
4. Add a default-off route-transition producer flag. While disabled, keep the
   prior home binding but append and process the inbound message normally; once
   the verified consumer is live, enable the atomic bind-plus-proof path.
5. Update focused tests and rollout documentation, then run the routed
   completion and PR gates.

## Constraints

- Keep the raw pending-index file as the single durable repair owner.
- Do not add a queue, scheduler, or new persisted service.
- Do not disable or drop onboarding, inbound reply, cron, auth, or privacy
  controls.
- Preserve reply-anchored routing and proactive current-home routing as
  distinct authorities.
- Preserve unrelated active-plan and working-tree changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## State

Active.
