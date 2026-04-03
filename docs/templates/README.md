# Device Provider Templates

Last verified: 2026-04-03

These are copy-paste starting points for new wearable providers.

Use them together:
- [`./device-sync-provider.template.md`](./device-sync-provider.template.md) for transport, auth, jobs, and optional webhook handling in `@murphai/device-syncd`
- [`./device-provider-adapter.template.md`](./device-provider-adapter.template.md) for snapshot parsing and normalization in `@murphai/importers`

Recommended flow:
1. read [`../device-provider-contribution-kit.md`](../device-provider-contribution-kit.md)
2. choose the first supported families from [`../device-provider-compatibility-matrix.md`](../device-provider-compatibility-matrix.md)
3. add a shared descriptor to `packages/importers/src/device-providers/provider-descriptors.ts`
4. copy the fenced code from these templates into real package files
5. wire defaults, config, exports, tests, and docs

These templates are intentionally conservative. They optimize for Murph's current seams rather than exposing every possible provider feature on day one.
