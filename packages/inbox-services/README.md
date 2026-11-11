# @murphai/inbox-services

Inbox initialization, reads, canonical document preservation and promotions, and storage repair for hosted Murph. Polling, daemon process control, and local connector configuration commands are retired.

Inbox reads and promotions depend on the canonical vault and inbox SQLite projection,
not a local connector configuration file. Initialization creates no connector config;
existing retired config files are ignored and left untouched. Rebuilds report the
count committed by the rebuild owner without scanning a capped list endpoint.

Older runner bundles require the retired config marker. A vault initialized by
this version needs this reader version as its rollback floor unless the older
bundle's inbox initialization runs before its inbox reads. Existing snapshots
remain readable; this change neither rewrites nor removes their retired files.

Document preservation reads only manifest paths identified by core's exact source evidence, including paths returned by imports earlier in the same batch. Member documents named `manifest.json` or `manifest.*.json` remain ordinary source bytes. Meal promotion uses the core vault walker. Both read manifests sequentially, and unreadable or invalid authoritative evidence blocks promotion instead of being treated as absence.
