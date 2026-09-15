# Delete reply-path route housekeeping

Status: completed
Created: 2026-09-12

Outcome: ordinary hosted replies perform no full-history route maintenance.
Reaches: successful, deferred, and no-progress foreground passes; background
migration; exact reply anchors; idle receipt retention.
Proof: foreground delivery/scheduling regressions, real route-state and idle
residue tests, relevant typechecks, complexity guard, and exact-head review/CI.

The product needs prior-message context and replay suppression. It does not need
full-history housekeeping attached to each reply. Exact-route reads already own
bounded reconciliation. Background passes and idle pruning already own migration
and full reconciliation. Delete the foreground call and the migration-only mode
introduced earlier in PR #3361; keep those existing owners unchanged.

Tradeoff: an unmigrated workspace waits for background/idle maintenance before
optional unanchored cross-session context becomes eligible. Exact provider-message
anchors remain usable before migration. Preserve this explicit fail-closed
boundary rather than scan legacy history between replies.

Implementation complete. Three regressions failed against the previous candidate.
Passed: 131 foreground delivery/scheduling tests, 68 route-state/residue tests,
10 changelog tests, assistant-runtime and assistant-engine typechecks, and
complexity guard. Parent source review is Ready. Final review/CI for the revised
PR remain pending and are tracked on PR #3361. No production deployment or measured
resolution of the separate container-wake stall is claimed.
Updated: 2026-09-12
Completed: 2026-09-12
