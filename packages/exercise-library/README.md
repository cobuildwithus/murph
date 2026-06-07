# Exercise Library

Workspace-private owner package for Murph's public movement catalog.

The committed source of truth is `content/seed/at-home-exercise-stretch.csv`.
Generated runtime artifacts live under `generated/` and are produced by:

```bash
pnpm --dir packages/exercise-library generate
```

The runtime entrypoint is `@murphai/exercise-library/runtime`.
