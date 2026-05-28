# Deploy Pass Hotfix

## Goal

Get the current hosted web verification and Cloudflare hosted execution deploy green.

## Scope

- Refresh the stale biomarker layout test assertion for the current mobile padding.
- Restore a narrow Cloudflare Queue consumer handler only to drain the retained live legacy runner-wake consumer.
- Keep generated Wrangler config free of Queue producer/consumer config.

## Constraints

- Preserve unrelated dirty hosted-web edits.
- Do not print or commit secrets, local paths, personal identifiers, or raw credentials.
- Keep the normal hosted runner path on direct Durable Object nudge plus alarm recovery.

## Verification

- Focused hosted-web biomarker layout test.
- Focused Cloudflare worker route/deploy tests.
- Cloudflare typecheck or verify lane where feasible.
- Fresh GitHub deploy watch after push.
