# @murph/gateway-local

Local vault-backed gateway runtime package for Murph.

This package owns the rebuildable local gateway projection store under `.runtime/gateway.sqlite`, the local gateway service wrappers, and the local send path that wires `@murph/gateway-core`'s transport-neutral contracts and projection helpers into the assistant, inbox, and runtime-state stack.

`@murph/gateway-core` stays transport-neutral and publishable on its own. Consumers that need the local vault-backed adapter should depend on `@murph/gateway-local` explicitly instead of a `gateway-core` subpath.
