# Assistant Outbox Hot-Path Lookups

Canonical assistant outbox intent JSON under
`.runtime/operations/assistant/outbox/**` remains the only authority for
outbound delivery, dedupe admission, provider-message evidence, and reply
context. The lookup files described here are machine-local, disposable
projections. They may accelerate a decision only after their publication and
the referenced canonical intent both validate. Any uncertainty returns to the
existing canonical scan.

## Ownership

`packages/assistant-engine/src/assistant/rebuildable-lookup-store.ts` owns one
generic filesystem projection primitive. It accepts opaque owner, kind, and key
values, hashes every path component, and has no channel, route, dedupe, or
outbox policy.

`packages/assistant-engine/src/assistant/outbox/lookup-projection.ts` is the
single outbox projection owner. It derives exact active-dedupe,
delivery-idempotency, legacy-compatibility, provider-message, mutation-barrier,
and bounded route records from canonical intents. Messaging route identity and
Telegram's positively-direct `@direct` policy remain pure functions in the
auto-reply route owner. The generic store never interprets them.

Lookup maintenance and auto-reply route-state maintenance are sibling units in
the existing assistant runtime maintenance pass. Neither owns the other, and
neither adds a queue, scheduler, database, service, or delivery state machine.

## Publication And Read Protocol

A generation has strict record files and 256 fixed bucket catalogs. The
publication document names one active generation, authenticates every bucket
catalog digest, and carries a random `publicationId`. A point read:

1. reads the publication and requires a complete active generation;
2. validates the requested bucket against its published digest;
3. validates any catalog entry, record identity, record digest, and strict
   owner parser;
4. reads and validates every referenced canonical intent;
5. rereads the publication and accepts the result only when both generation and
   `publicationId` are unchanged.

The before-and-after witness prevents an ABA rebuild from making an older read
look stable. A missing record, removed positive, malformed payload, mismatched
bucket, partial write, dangling canonical reference, unknown version, or changed
publication is not a trusted miss. It falls back canonically and does not throw
into foreground reply work.

A bucket catalog also proves exact absence. This is why the projection does not
use unauthenticated sparse files: deletion of a positive record would otherwise
look like a valid negative.

## Canonical Mutation Ordering

All lookup-relevant canonical writes use one outbox mutation seam under the
existing cross-process assistant runtime write lock. The owner derives old and
new projections, then:

1. prewrites additions into each active or in-progress generation;
2. writes canonical intent state;
3. applies removals;
4. publishes a new random `publicationId` only after the projection matches the
   completed mutation.

A reader that overlaps a prewrite sees a bucket/publication mismatch and falls
back. A stale positive left by a post-canonical failure still fails canonical
revalidation. When an active prewrite cannot be established, active trust is
invalidated before the canonical write. When the canonical write fails, the
owner publishes a fresh resumable rebuild instead of leaving repair disabled.
If final publication fails, publication removal is best effort; the same bucket
mismatch or canonical revalidation rules remain safe. A failed unpublished
building invalidation cannot block canonical foreground work. The only
pre-canonical sidecar failure that aborts is one that would otherwise leave an
unprotected active generation able to publish a trusted false miss.

Provider dispatch uses a bounded canonical-mutation barrier. Entering `sending`
without provider evidence publishes that barrier before the irreversible
provider interval. All lookup readers fall back until durable provider evidence
or a failure transition removes it. Provider-message evidence larger than the
fixed per-intent bound degrades only provider-anchor lookup, not dedupe or route
reads.

## Bounded Work

Foreground exact reads do not enumerate lookup or canonical directories. A
lookup reads two publication witnesses, one fixed bucket catalog per opaque key,
any matching small ref record, and only referenced canonical intents.

One canonical mutation may change at most 48 logical lookup records. A
metadata-only transition whose projection is unchanged writes no lookup record
or publication. Each changed record can require one strict record write and one
changed bucket-catalog write per maintained generation. A successful mutation
normally uses one final publication write and can use one additional
pre-canonical publication write only to revoke a failed active or building
prewrite, for the fixed maximum exported by the owner. The route projection
retains at most 32 ordered candidates per route plus a constant-size summary of
omitted history. The route owner uses that summary only when it proves omitted
history cannot change the requested latest-context or echo-suppression answer;
it falls back canonically whenever omitted history could affect route identity,
causal bounds, the current-session exclusion, the watermark, or the echo
window. Maintenance rebuilds the compact summary from canonical state.

Rebuild processes at most 128 canonical intents per maintenance pass. Its
cursor and already-written bucket catalogs are resumable after interruption.
Only a generation whose files validate and whose complete bucket-digest set is
equivalent to the current canonical inventory can become active. Stale
unpublished generations are removed by the same maintenance owner.

## Compatibility And Rollout

A process that does not know this projection cannot update its publication when
it writes canonical outbox state. No generation or file protocol can detect a
live old writer after that writer creates a new canonical record, so safe
mixed-writer rollout is explicit:

1. begin with no active publication and drain every older reader/writer for
   the workspace before any new process can persist the optional strict-schema
   compatibility field;
2. deploy the central canonical mutation seam, lookup readers, schema support,
   and maintenance owner to every process that can read or write the vault;
3. keep canonical fallback active while the all-current-writer rebuild runs;
   an older process must not be admitted again after this point;
4. treat the first complete all-current-writer publication as the rollback
   floor;
5. before downgrading to a binary that lacks the seam or canonical field, drain
   current readers/writers and remove
   `.runtime/projections/assistant-rebuildable-lookups/**` before the older
   binary is admitted.

Hosted snapshots exclude this machine-local subtree. A restored or newly
mounted workspace therefore starts with canonical fallback and rebuilds. The
legacy `.runtime/operations/assistant/outbox/.lookups-v1` stale-candidate path is
removed only after a complete new generation publishes.

## Observability

Foreground history metrics retain bounded counts for lookup reads, files,
bytes, elapsed time, publication retries, canonical validation files and bytes,
and the first fallback reason. Canonical dedupe fallback also reports its
inventory files, bytes, and elapsed time through the existing in-process
observation seam. Maintenance reports projection writes, canonical intents
processed, generation cleanup, rebuild start/resume/completion, repair, and
whether the result is trusted. These are aggregate metadata only; raw route,
provider-message, identity, and dedupe values are never emitted or used in file
paths.
