import { readFile, writeFile } from 'node:fs/promises'

const workoutCommandPath = new URL(
  '../packages/cli/src/commands/workout.ts',
  import.meta.url,
)
let source = await readFile(workoutCommandPath, 'utf8')

const importLine = "import { registerWorkoutLiveCommands } from './workout-live.js'"
if (!source.includes(importLine)) {
  const importAnchor =
    "import { normalizeOccurredAtOption } from './occurred-at-option.js'\n"
  if (!source.includes(importAnchor)) {
    throw new Error('Could not find the workout command import anchor.')
  }
  source = source.replace(importAnchor, `${importAnchor}${importLine}\n`)
}

const registrationLine = '  registerWorkoutLiveCommands(workout)'
if (!source.includes(registrationLine)) {
  const registrationAnchor = `  const workout = Cli.create('workout', {
    description:
      'Workout façade commands over activity sessions, workout-format docs, CSV import, and saved unit preferences.',
  })
`
  if (!source.includes(registrationAnchor)) {
    throw new Error('Could not find the workout command registration anchor.')
  }
  source = source.replace(
    registrationAnchor,
    `${registrationAnchor}\n${registrationLine}\n`,
  )
}

await writeFile(workoutCommandPath, source)
