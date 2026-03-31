# @murph/gateway-core

Dedicated headless gateway boundary package that owns Murph's transport-neutral route, projection, opaque-id, and event-log helpers plus the local vault-backed `./local` gateway service surface used by assistantd, hosted adapters, and future MCP-compatible transports. The local store now consumes inboxd's durable capture mutation cursor for incremental capture sync and still keeps full projection rebuilds as the bootstrap/recovery path.
