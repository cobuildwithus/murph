# Family Plan Typecheck Mock

## Goal

Fix the hosted Family plan test typing that blocks `apps/web` typecheck after
the Prisma client is generated.

## Scope

- Narrowly adjust the Family plan Prisma transaction mock typing.
- Keep production Family behavior unchanged.

## Verification

- Run the hosted web typecheck.
- Run the focused Family plan test file if the typecheck edit affects runtime.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
