# @murphai/gateway-core

Transport-neutral gateway contracts, route helpers, and opaque ids for Murph.
The package does not depend on assistant, inbox, or local runtime-state owners.

## Breaking API removal

The next major release removes projection snapshots, snapshot read/diff helpers,
event-log state and polling helpers, and the associated event, snapshot, polling,
and waiting schemas and types. There is no replacement projection or event-log
API in this package. External consumers using these exports must retain the
previous major version until they have removed that integration.

Conversation, message, attachment, permission, send, route, and opaque-id
contracts remain available. Existing route normalization and delivery semantics
are unchanged. Repository consumers use those retained contracts; no production
repository consumer used the removed subsystem.

Murph publishes its public packages under one shared version. Ship this API
removal through the existing major-release workflow, not a patch/minor release.
