# @murphai/gateway-local

Workspace-private local vault-backed gateway runtime package for Murph.

This package owns the rebuildable local gateway projection store under `.runtime/projections/gateway.sqlite`, the local gateway service wrappers, and the local send path that wires `@murphai/gateway-core`'s transport-neutral contracts and projection helpers into the assistant, inbox, and runtime-state stack.

The local store now persists only source-side gateway tables plus event and metadata state. Conversation, message, and attachment snapshots are derived from those source rows on demand instead of being persisted as a second serving-table layer.

`@murphai/gateway-core` stays transport-neutral and publishable on its own. Workspace or bundled consumers that need the local vault-backed adapter should depend on `@murphai/gateway-local` explicitly instead of a `gateway-core` subpath.
