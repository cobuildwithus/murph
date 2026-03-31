# @murph/gateway-core

Dedicated transport-neutral gateway boundary package for Murph.

This package owns Murph's gateway contracts, route helpers, projection/snapshot helpers, opaque ids, and event-log utilities. It intentionally does not depend on the assistant, inbox, or local runtime-state stacks.

Consumers that need the local vault-backed gateway adapter should depend on `@murph/gateway-local` explicitly. That package owns the rebuildable `.runtime/gateway.sqlite` serving store plus the local send/read wrapper surface.
