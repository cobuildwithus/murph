---
title: 'Worker upload dry-run cannot validate inheritance source support'
severity: 'minor'
issue: 'cobuildwithus/murph#4099'
---

## Expected Behavior

Worker cleanup proof should distinguish local Wrangler serialization from server acceptance of an inheritance source and exercise the actual latest-version history boundary.

## Current Behavior

The pinned Wrangler dry-run emits arbitrary unsafe binding metadata, including a synthetic UUID version_id, without contacting the upload API. The existing fixture therefore passed while proving no server support for that selector. Current API documentation also permits a selector that the upload boundary cannot assume is supported.

## Possible Solution

Use ordinary upload followed by the official native version-secret merge PATCH for the exact retired names. Delete custom inheritance/config reconstruction; preserve complete inventory and version-history guards. Label dry-run evidence as serialization-only and keep the protected deployment as the external acceptance gate.

## Minimal Reproducible Example

Configure a synthetic unsafe binding with name OPTIONAL_SECRET, type inherit, and version_id 11111111-1111-4111-8111-111111111111. Run pinned Wrangler versions upload --dry-run --outfile against a synthetic Worker. The multipart metadata retains the identifier without testing server acceptance or the latest-version relationship. Likewise, inspecting an empty keep_bindings array proves its serialization but not server-side deletion of omitted secrets. Synthetic provider-shaped tests must exercise the native two-null PATCH contract separately.

## Context

This is a repository verification gap at the Worker upload boundary. Synthetic fixtures and metadata-only guards can cover source drift without reading secret values or attempting an external mutation.

Provider-shaped recovery fixtures must also distinguish an unknown inactive
latest version from an explicitly selected trusted upload. Use synthetic UUIDs
and tags to prove paired inputs, worker-only/synchronized-payload requirements,
complete secret name/type equality and fresh-upload history. Keep the live
version authoritative; metadata equality is not proof of opaque value equality.
