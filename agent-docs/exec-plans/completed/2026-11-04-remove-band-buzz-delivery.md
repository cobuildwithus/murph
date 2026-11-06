# Remove retired band command delivery

## Outcome and scope

Remove server command admission, delivery, assistant offers and dedicated storage.
Preserve health-device sync/imports, live game heart rate, game pushes, and app
presence diagnostics. All work stays local and uncommitted in this checkout.

## Evidence and approach

The device tool mixes command effects with supported data/account operations;
delete only command branches. Presence also serves private and consented group
sync diagnostics. Shared Apple transport serves game notifications.

Use the existing postdeploy contract migration lane, after Web promotion and
old-function drain. No predeploy destructive migration or database execution.
Installed native clients keep a bounded two-second foreground loop on a missing
endpoint; inactive responses would re-link, so delete rather than add a stub.
Older runners catch callback failure as a non-retryable tool failure; deploy the
new runner after Web to remove its offer. Document rollback floor and warm skew.

## Product UX and proof

Direct and existing scheduled band-control requests must not create effects or
claim success. Supported account diagnostics and ordinary reminders stay usable.
Inspect the production tool schema, exercise focused boundaries and preserved
push/presence paths, and add a production-derived live assistant journey.
Run touched-owner typechecks, migration/schema/export/config/budget guards and
focused tests. No real database, production effect, commit, push, PR or deploy.

## Progress

- Implementation and parent diff review complete. Five touched-owner typechecks,
  Prisma validation, focused tests, export/config/budget guards and docs checks pass.
- Deterministic UX boundaries are Ready. New direct and scheduled capability
  journeys compile; live reply review is Hold because Codex startup requires
  writes outside the permitted checkout. The task-start main baseline reproduces
  the same failure with zero provider requests under the same containment.
- The requested audit report records file inventory, deployment/skew reasoning,
  exact verification results and the remaining live-proof limitation.
- No database migration, production mutation, commit, push or PR was performed.
Status: completed
Updated: 2026-11-04
Completed: 2026-11-04
