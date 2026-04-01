# @murphai/gateway-local

Local vault-backed gateway runtime package for Murph.

This package owns the rebuildable local gateway projection store under `.runtime/gateway.sqlite`, the local gateway service wrappers, and the local send path that wires `@murphai/gateway-core`'s transport-neutral contracts and projection helpers into the assistant, inbox, and runtime-state stack.

`@murphai/gateway-core` stays transport-neutral and publishable on its own. Consumers that need the local vault-backed adapter should depend on `@murphai/gateway-local` explicitly instead of a `gateway-core` subpath.
