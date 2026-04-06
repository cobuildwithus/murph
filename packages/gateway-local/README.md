# @murphai/gateway-local

Local vault-backed gateway runtime package for Murph.

This package owns the rebuildable local gateway projection store under `.runtime/projections/gateway.sqlite`, the local gateway service wrappers, and the local send path that wires `@murphai/gateway-core`'s transport-neutral contracts and projection helpers into the assistant, inbox, and runtime-state stack.

The serving snapshot now persists only the indexed relational rows the local gateway needs to answer reads quickly. Full snapshot JSON is re-materialized at read time instead of being duplicated as stored blobs alongside those indexes.

`@murphai/gateway-core` stays transport-neutral and publishable on its own. Consumers that need the local vault-backed adapter should depend on `@murphai/gateway-local` explicitly instead of a `gateway-core` subpath.
