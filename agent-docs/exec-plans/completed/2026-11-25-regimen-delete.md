# Remove a mistaken regimen by ID

Status: completed
Created: 2026-11-25
Updated: 2026-11-25

## Outcome

A caller can correct an erroneous regimen with `vault-cli regimen delete <regimenId>`. A genuine end to a regimen still uses `regimen stop`.

## Implementation and proof

- Follow the food delete path from the CLI to the canonical Markdown registry. Resolve the one ID under the regimen write lock and preserve the existing audit receipt.
- Use synthetic records to verify the file disappears, the remaining record stays listed, a repeated deletion reports a missing record, and the deletion dirties the assistant's health context.
- Update command discovery, the timing vocabulary, generated artifacts and the executable contract checks. Exercise the direct assistant route with an explicitly identified mistaken record.
- Run focused tests, touched-package typechecks, generation and scenario checks, then open the PR for review.

## Results

The built CLI removed only the requested ID and returned `not_found` on retry. Core tests exercised all four kinds, the registry lock and the audit target. Save and delete receipts both dirtied only `health_context`; the obsolete title was absent before and after refresh.

The audit action enum and its generated JSON Schema now include `regimen_delete`. The CLI artifact verifier, package typechecks, focused suites, complexity guard and scenario integrity passed.
Completed: 2026-11-25
