# Preserve runner namespace container declarations

Status: active
Created: 2026-09-08

## Outcome and invariant

Restore native candidate creation after a Worker-only release. Keep native
admission before Worker upload, preserve serving capacity and release identity,
and do not introduce namespace migrations or new production credentials.

## Proven cause and scope

The protected native POST rejected with `DURABLE_OBJECT_NOT_CONTAINER_ENABLED`.
Worker-only staging omits absent applications from its container array. Pinned
Wrangler derives Worker container-enabled class metadata from that same array,
so receipt filtering also drops namespace capability declarations. Two focused
regressions fail before source edits: the absent class is missing and the CLI
uploads the receipt config instead of the complete class declaration config.

Keep the existing native receipt config. For Worker-only uploads with omitted
applications, derive a complete container declaration config from the same
rendered entries, require existing namespace bindings, and preserve every live
application setting and release variable. Only version upload uses that config.
The regular full-release admission sequence stays unchanged.

## Work and verification

- Reproduced both failures with synthetic staging and CLI scenarios.
- Implement the declaration-preserving upload and verify both bank directions,
  absent namespace rejection, native receipt scope, and admission ordering.
- Run focused tests, Cloudflare typecheck, complexity and parent review, then
  required exact-head CI and ReviewGPT on a scoped PR.
- After merge, a protected Worker-only release must restore declarations. A
  subsequent protected full release must prove actual native admission, signed
  smoke, and release convergence before claiming the runner fix is live.

Cloudflare recovery for an already provisioned namespace remains unverified
until the protected follow-up. Do not infer success from local mocks or delete
and recreate existing namespaces. No matching open repair PR was found.

## Candidate evidence

All 69 focused provider, image, staging and deployment CLI tests pass. Both
member bank directions retain complete Worker metadata while native receipts
exclude absent applications; missing namespaces fail before upload. Cloudflare
typecheck and complexity guard pass, with no function above the threshold.
Pinned Wrangler passes `config.containers` to version upload metadata and does
not deploy native applications in that command. Parent review found no serving
image, capacity, release pointer, native mutation or admission-order change.
The change is internal deployment repair; no separate member changelog item.
