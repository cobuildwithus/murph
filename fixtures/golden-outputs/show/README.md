# `vault-cli show`

Current smoke expectation:

- accepts queryable ids such as `evt_*`, `exp_*`, `smp_*`, `aud_*`, `core`, and `journal:<date>`
- rejects related ids like `meal_*`, `doc_*`, plus batch/derived ids like `xfm_*` and export-pack ids
- `links[].queryable` signals whether a related id is safe to pass back into `show`

Explicit receipt inspection uses `vault-cli audit receipt <xfm_id> --vault <path>`.
Its data is `{ vault, receipt }`, with `receipt: null` for an unknown receipt, or
`receipt: { relativePath, record }` for a validated plain or archived integration
receipt. The record retains evidence parts, outputs, and optional publication
counts. Ordinary `show` keeps rejecting batch ids.
