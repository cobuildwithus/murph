# Recover incomplete device-sync snapshot reads within the existing deadline

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Recover a transient, proven incomplete snapshot response without waiting for the next durable job pass or adding Worker body buffering.

## Product UX

- Outcome: connected-device work can continue after a transient incomplete internal state read.
- Reaches: snapshot reads in the existing hosted device-sync consumer; existing auth, provider requests and durable retry ownership remain intact.
- Proof: transient empty/partial response followed by valid state; persistent failure; cancellation/deadline; authorization rejection; valid and legacy response acceptance. Patch effort, no UI or assistant-prompt change.

## Scope and decisions

- Extend the existing consumer byte-count/error classifier and exact single-replay owner; no additional retry loop or Worker stream manipulation.
- Reclassify only an already rejected empty or invalid-JSON snapshot with a valid expected count strictly exceeding streamed bytes. Preserve valid response acceptance and missing/invalid diagnostic marker compatibility.
- At most two Web attempts within the original total timeout. Persistent failures return to the existing durable retry owner.
- Production patch is authored by ReviewGPT. Parent owns evidence, review, documentation/changelog and PR completion.
- Treat upstream workerd behavior as a reproduced possible mechanism, not a proven initiating production cause. This change is bounded recovery.

## Risks

- A replay adds a Web read and can use more of the existing deadline. Prove request count, deadline and cancellation rather than extending budgets.
- Diagnostic metadata must not become an auth/integrity gate for successful JSON. Cover valid mismatched markers and old producers.
- Shared transport changes must not broaden retry for non-snapshot routes or application/schema errors.
- No raw bodies, identifiers, raw headers, new correlation fields or private production records in logs or fixtures.

## Tasks

1. Establish clean ownership and current base; complete the production author patch.
2. Run focused tests and Cloudflare typecheck, review complexity and privacy, and write the member recovery note.
3. Commit, push and open a draft PR; complete candidate review before Ready.
4. Run applicable final ReviewGPT with exact-head CI, preserve any unresolved gate honestly, and return the PR link.

## Verification

- Red proof: six real-HTTP cases fail on unchanged production source across empty/partial identity, gzip and Brotli responses. They require the actual snapshot port to recover within one call and preserve the exact request body.
- Documentation drift check passed for the active plan.
- Production author patch and candidate checks pending. Earlier native-runtime investigations do not substitute for testing this candidate.
