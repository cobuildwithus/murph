# Drop completed action receipts from restored runtime work

Web owns the outcome of a member action. Fresh imports already acknowledge a completion receipt without scheduling work. Older workspace snapshots could still carry queued copies and require a fresh runtime pass for each receipt.

The saved mailbox reader now validates each entry and drops completed action receipts with no outstanding checkpoint callback. Pending actions and checkpoint callbacks keep their place in the queue.

A synthetic snapshot reproduced the stuck frontier before the fix. The regression test covers pending, sending and recording receipts, an adjacent request awaiting outcome publication, and wake selection after the last receipt. All 87 focused runtime tests and four changelog tests passed. The runtime and Web typechecks passed. Production activation requires a runner image release.
Status: completed
Updated: 2026-11-19
Completed: 2026-11-19
