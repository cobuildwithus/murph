# References

Reference docs capture stable internal maps, external dependency notes, and verification wiring that agents should not rediscover from scratch every turn.

## Rules

- Keep references factual and map-oriented.
- Mark unknowns as `UNCONFIRMED`.
- Update `agent-docs/index.md` when adding or moving reference docs.

## Foreground Reply State Cardinality

Foreground reply work must not grow with unrelated persisted state after a shared saturation bound. This is an asymptotic regression contract, not a latency benchmark or an absolute payload budget.

The dedicated GitHub Actions check is `Foreground reply state cardinality`.

Production probes run the same foreground operation with valid unrelated state at cardinalities `1`, `8`, `128`, and `256`. The shared meter records filesystem read operations, directory entries returned, total content bytes read, and the largest individual content read beneath the probe's vault root. Every metric must be identical at cardinalities `128` and `256`.

The upper samples deliberately sit above the repository's current fixed collection caps, including the 50-item automation scan limit and 100-item answered-mailbox limit. This admits a genuinely fixed-cap fallback while rejecting continued linear, compact-linear, or logarithmic growth. Absolute payload, operation-count, and latency limits remain with the owning production contract.

A production probe supplies only the irreducible state-specific setup:

```ts
{
  name,
  async prepare(cardinality) {
    // Create valid unrelated state through the production owner.
    return {
      root,
      async loadOperation() {
        // Load and return the real foreground operation after metering starts.
      },
    }
  },
}
```

The shared harness owns the cardinality ladder, module reset, filesystem meter, assertion, diagnostics, and CI discovery. Production probes are conventionally named `*-state-cardinality.test.ts` beneath a package or app `test/` directory; no central registry is maintained.

The meter covers promise, callback, synchronous, preloaded named-import, and `fs.promises` forms of content reads, directory enumeration, common path metadata reads, and promise `open` plus `FileHandle.read`, `readv`, `readFile`, and `stat`. Promise, callback, and synchronous `opendir` handles count returned entries, including async-iterator consumption. Unsupported stream and legacy descriptor-read paths fail closed with an instruction to extend the one shared meter and add a canary.

The separately named harness test does not satisfy production-probe discovery. It proves fixed large work and a fixed-cap 100-record fallback remain admissible while content, directory, metadata, compact-payload, and logarithmic read growth are rejected.

Current production boundaries cover:

- auto-reply routing through the real assistant service and queue-only durable reply handoff while unrelated outbox state grows;
- hosted foreground input selection while unrelated pending input grows; and
- exact conversation-to-session resolution while unrelated session routes grow.

Maintenance rules:

- Keep one global saturation rule; do not add per-probe exceptions.
- Seed unrelated state through the owning production writer.
- Keep current input, route, and requested operation identical across samples.
- Import the measured production boundary only from `loadOperation`.
- Extend the shared meter once when a new storage primitive is admitted.
- Keep absolute product limits in their existing owners.
- Do not replace filesystem-work assertions with wall-clock thresholds.

After the known production owners are bounded and this check is green, add the exact context `Foreground reply state cardinality` to the active main ruleset.
