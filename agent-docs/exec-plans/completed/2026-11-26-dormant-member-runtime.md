# Pause starts for dormant member runtimes

Use the existing Web/Postgres claim and confirmed cold-release paths. A personal
member's next confirmed shutdown after 60 days without human activity pauses
all processing modes. A newly accepted member message, sign-in, foreground
companion heartbeat or authenticated Web visit restores normal admission.
Keep shared rooms, account access, snapshot storage and deletion independent.

Verify exact cutoff, background events, duplicate or stale events, recent
activity, cold versus warm release and every processing mode. Exercise the
database and existing session and messaging paths. Deploy the additive schema
before the Web release and verify the production deployment.

Local verification applied the migration from the complete database history.
The runtime owner, both mailbox append paths, sign-in, browser session,
foreground and background presence, reconciliation, and release note rendering
were exercised. The Web typecheck passed. A start-budget test exceeded its
transaction timeout during a loaded run and passed in isolation. Historical
Web sessions removed before rollout cannot supply evidence for the initial
decision. PR 5344 carries the deployment and CI evidence.
Status: completed
Updated: 2026-11-26
Completed: 2026-11-26
