# Internal fetch failure correlation

## Outcome and evidence

Existing internal-request failure events identify a finite operation and cancellation category but omit the runtime attempt. That prevents exact joins to foreground versus background ownership and the original attempt's later checkpoint or invocation outcome. The shared internal fetch path is used by mailbox and replica operations; chronological proximity and another attempt's progress are insufficient attribution.

This is a targeted telemetry change, not a correction to timeout, cancellation, completion, or replica behavior. Historical failures remain unresolved until exact evidence establishes their outcome.

## Scope and invariants

Reuse the existing structured failure event and its existing opaque attempt field. Prefer the already-read canonical lease over unchecked request headers. Do not add lease reads, network calls, database queries, retry, timeout, logging volume, authority changes, new monitoring, state, dependencies, or configuration. Successful requests and original error identity must remain unchanged. Omit unavailable correlation rather than guessing. No private production content or identifiers enter source, proof, or review packets.

## Ownership

This checkout owns only the internal-fetch diagnostic addition, focused tests, owner documentation, and this plan. Other open changes in runtime idle cleanup, vault-share projection, and knowledge commands have different scopes and no overlapping implementation file. Do not modify their checkouts or releases.

## Steps

1. Ask ReviewGPT to implement the smallest safe addition and focused synthetic regression proof.
2. Inspect the patch, prove new assertions fail against the base, and run focused tests, typecheck, and complexity review.
3. Push a scoped draft PR, mark Ready after parent review, and start final ReviewGPT concurrently with required exact-head CI.
4. Complete the normal gates. A telemetry-only merge and canonical release are authorized; confirm the release slot and compatibility first. Observe the deployed revision and natural failure fields separately. Do not reset the current observation deadline before a correction actually deploys.

## Product and deployment

Internal diagnostics only; no user-facing or provider-input change and no changelog item. Full runner image deployment is required for runner-side code. Optional fields tolerate old and new images; missing fields are an observation gap. The existing production observation owner remains in this chat.

## Progress

- Current source and existing structured-log owner inspected. No functional cause has been proved.
- Fresh sanctioned checkout at the current main revision; dependencies installed with the frozen lockfile.
- ReviewGPT authoring accepted; retain the same request through capture.
- Existing refresh-deadline proof: two focused tests passed for cancellation at the refresh deadline and an earlier caller deadline. This verifies the mechanism, not production attribution.
- Open PR diffs for idle cleanup, vault-share projection, and knowledge consumers do not implement this failure-correlation question or touch its implementation file.

- Cloudflare base typecheck passed after the standard local Prisma generation step. The initial missing generated-client failure matches existing repository friction; no source workaround or dependency change.

## Candidate verification

- ReviewGPT authored the source, focused tests, and owner documentation. Parent inspection confirmed that only the already-read lease string is captured before fetch; no request headers or late lease are used as diagnostic truth.
- Negative proof: with the new tests on unchanged source, the two current-lease failure assertions failed because correlation was absent; the other twelve cases passed.
- Positive proof: all 294 existing runtime-platform tests passed, including the fourteen new transport/authority/success and missing-authority cases. They check exact error/response identity, original request-start correlation despite later lease mutation, no extra reads or fetches, identical headers/body/log sequence, and private sentinel exclusion.
- Cloudflare typecheck passed. Complexity guard passed: debt remains zero, maximum remains 16, and there are no changed-source hotspots above 20. `git diff --check` passed.
- Internal diagnostics only: no provider-input or member-facing surface changed. No changelog item is applicable.
- Final pushed-candidate review, required CI, merge, full-image release, and natural-traffic observation remain pending. Historical failure causes remain unresolved.
