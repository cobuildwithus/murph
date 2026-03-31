# @murph/gateway-core

Dedicated headless gateway boundary package that now owns Murph's transport-neutral route, projection, opaque-id, and event-log helpers. The `./local` subpath remains the compatibility bridge to the local vault-backed implementation.

The root package now owns the transport-neutral gateway contracts/helpers directly. The `./local` subpath still fronts the vault-backed local implementation while Murph preserves monolithic compatibility exports during the cutover.
