import { readFile, writeFile } from 'node:fs/promises'

async function update(path, transform) {
  const current = await readFile(path, 'utf8')
  const next = transform(current)
  if (next === current) return
  await writeFile(path, next)
}

await update(
  new URL('../packages/cli/src/commands/workout.ts', import.meta.url),
  (source) => {
    const importLine = "import { registerWorkoutLiveCommands } from './workout-live.js'"
    if (!source.includes(importLine)) {
      const anchor =
        "import { normalizeOccurredAtOption } from './occurred-at-option.js'\n"
      if (!source.includes(anchor)) {
        throw new Error('Could not find the workout command import anchor.')
      }
      source = source.replace(anchor, `${anchor}${importLine}\n`)
    }

    const registrationLine = '  registerWorkoutLiveCommands(workout)'
    if (!source.includes(registrationLine)) {
      const anchor = `  const workout = Cli.create('workout', {
    description:
      'Workout façade commands over activity sessions, workout-format docs, CSV import, and saved unit preferences.',
  })
`
      if (!source.includes(anchor)) {
        throw new Error('Could not find the workout command registration anchor.')
      }
      source = source.replace(anchor, `${anchor}\n${registrationLine}\n`)
    }
    return source
  },
)

await update(
  new URL('../packages/cli/src/commands/workout-live.ts', import.meta.url),
  (source) => source
    .replace(
      "    hint:\n      'Read workout active first and pass an explicit unused --order. Retrying the same name/source id at that order is a no-op.',\n",
      '',
    )
    .replace(
      "    hint:\n      'Agents should first read workout active, then pass --workout-id, an explicit exercise selector, and --set-order. Repeating the same command then corrects the same canonical set instead of appending a duplicate.',\n",
      '',
    ),
)

await update(
  new URL(
    '../packages/vault-usecases/src/usecases/workout-read.ts',
    import.meta.url,
  ),
  (source) => {
    if (!source.includes('const MAX_LIST_LIMIT = 200')) {
      source = source.replace(
        'const DEFAULT_LIST_LIMIT = 5\n',
        'const DEFAULT_LIST_LIMIT = 5\nconst MAX_LIST_LIMIT = 200\n',
      )
    }
    return source.replace(
      'Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))',
      'Math.max(1, Math.min(MAX_LIST_LIMIT, Math.round(input.limit)))',
    )
  },
)
