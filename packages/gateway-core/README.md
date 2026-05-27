# @murphai/gateway-core

Dedicated transport-neutral gateway boundary package for Murph.

This package owns Murph's gateway contracts, route helpers, projection/snapshot helpers, opaque ids, and event-log utilities. It intentionally does not depend on the assistant, inbox, or local runtime-state stacks, and it does not provide a local vault-backed runtime.
