import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { initializeVault, upsertMemory } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { readMealNutritionTotals } from '@murphai/query'

import { stopWarmCodexAppServer, waitForWarmCodexBackgroundWork } from '../../src/assistant-codex.js'
import { runAssistantAutomationPass } from '../../src/assistant/automation/run-loop.js'
import {
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from '../../src/assistant/input-store.js'
import { NUTRITION_GOAL_INVITATION_SENT_MEMORY } from '../../src/assistant/nutrition-card-introduction.js'
import { listAssistantOutboxIntents } from '../../src/assistant/outbox.js'
import { saveAssistantAutomationState } from '../../src/assistant/store.js'
import { canonicalCodexLauncher } from './canonical-codex-launcher.js'

const execFileAsync = promisify(execFile)
const CLI_ENTRYPOINT = fileURLToPath(new URL('../../../cli/dist/bin.js', import.meta.url))
const PINNED_CODEX = fileURLToPath(new URL('../../node_modules/.bin/codex', import.meta.url))
const TIME_ZONE = 'America/New_York'
const THREAD_ID = 'meal-intake-benchmark-thread'

/**
 * Local, opt-in speed benchmark for one inbound Linq meal message. Photos are
 * public Food-101 validation images and labels are synthetic panels for
 * fictional products; neither is committed. Point
 * MURPH_MEAL_INTAKE_BENCH_IMAGE_DIR at the prepared directory and
 * MURPH_MEAL_INTAKE_BENCH_DATA_API_PROXY at apps/web/scripts/local-food-labels-api.ts.
 */
export interface MealIntakeBenchmarkCase {
  id: string
  category: 'home-cooked' | 'label' | 'photo' | 'restaurant'
  text: string | null
  image?: { file: string, sha256: string }
  /** Generous plausible range for the new meal; it guards gross errors, not accuracy. */
  calories: readonly [number, number]
}

const photo = (file: string, sha256: string) => ({ file, sha256 })

export const MEAL_INTAKE_BENCHMARK_CASES: readonly MealIntakeBenchmarkCase[] = [
  { id: 'photo-pulled-pork-plate', category: 'photo', text: null,
    image: photo('photo-pulled-pork-plate.jpg', '675ea0c58bf9703e7ddb073d41b964e3a6a22d4b49634dfa1099370d661237a0'), calories: [700, 1900] },
  { id: 'photo-sushi-rolls', category: 'photo', text: null,
    image: photo('photo-sushi-rolls.jpg', 'e5e36beb08cdf83ad1a70cb12b9c50417f752a2eb12e03bb40bf427aaf548eed'), calories: [350, 900] },
  { id: 'photo-club-sandwich', category: 'photo', text: 'ate the sandwich and about half the fries, skipped the slaw',
    image: photo('photo-club-sandwich.jpg', '54afaa875de51d3eba2e5c9260c566019ca24f45452d0f2153f143b1418fa1e7'), calories: [550, 1300] },
  { id: 'photo-chicken-pho', category: 'photo', text: 'chicken pho, finished the bowl',
    image: photo('photo-chicken-pho.jpg', '4b1cf8ebf84ddcd1fbaf68cb51bc64cd2e850b0f0968e241ac6c7b4d0fd05f7b'), calories: [300, 800] },
  { id: 'photo-eggs-benedict', category: 'photo', text: 'brunch',
    image: photo('photo-eggs-benedict.jpg', '4b8965bdec5f0750aa5b6343d069e9798e3d115075aeb1de99a1c114bcdbd07a'), calories: [650, 1400] },
  { id: 'photo-spaghetti-bolognese', category: 'photo', text: 'made this at home, about 2 cups',
    image: photo('photo-spaghetti-bolognese.jpg', '881f27eb1bd8511c9c836f2662a9998cdab1a04a01edace9b01ee40c8c296866'), calories: [450, 950] },
  { id: 'photo-mushroom-risotto', category: 'photo', text: 'mushroom risotto at a restaurant plus the beer',
    image: photo('photo-mushroom-risotto.jpg', '870a030aa9063be2ee1ab65d1ae32bed6f526a0a955deb4f776cb1ce01435bc6'), calories: [550, 1300] },
  { id: 'photo-brisket-nachos', category: 'photo', text: 'brisket nachos, I ate about half',
    image: photo('photo-brisket-nachos.jpg', '2995796bb57c6faa0d29e588b025ea3a96a0cde31781bc4dbe0a54cb41a1643e'), calories: [400, 1100] },
  { id: 'photo-beignets-coffee', category: 'photo', text: '3 beignets and the cafe au lait',
    image: photo('photo-beignets-coffee.jpg', '19b917e2235c90c04a6ba0423911219e2a12d9e68c2a39bb5259c382bfede3ca'), calories: [450, 950] },
  { id: 'restaurant-chipotle-bowl', category: 'restaurant', calories: [750, 1250],
    text: 'Chipotle chicken burrito bowl with white rice, black beans, fajita veggies, fresh tomato salsa, cheese and guac' },
  { id: 'restaurant-big-mac-fries', category: 'restaurant', calories: [780, 1050],
    text: 'Big Mac and a medium fries from McDonalds' },
  { id: 'restaurant-starbucks-latte-croissant', category: 'restaurant', calories: [380, 650],
    text: 'grande oat milk latte and a butter croissant from starbucks' },
  { id: 'restaurant-chick-fil-a', category: 'restaurant', calories: [680, 1100],
    text: 'chick fil a 8 count nuggets, medium waffle fries and a small lemonade' },
  { id: 'restaurant-sweetgreen-harvest', category: 'restaurant', calories: [550, 900],
    text: 'sweetgreen harvest bowl' },
  { id: 'home-eggs-toast-avocado', category: 'home-cooked', calories: [470, 760],
    text: '2 eggs scrambled in a tablespoon of butter, 2 slices of sourdough toast, half an avocado' },
  { id: 'home-chicken-rice-broccoli', category: 'home-cooked', calories: [560, 900],
    text: '6 oz grilled chicken thighs, 1 cup cooked jasmine rice, 1.5 cups roasted broccoli with 1 tbsp olive oil' },
  { id: 'home-overnight-oats', category: 'home-cooked', calories: [370, 540],
    text: 'overnight oats: 1/2 cup rolled oats, 3/4 cup 2% milk, 1 tbsp chia seeds, 1 tbsp peanut butter, half a banana' },
  { id: 'label-protein-bar', category: 'label', text: 'ate this whole bar', calories: [225, 235],
    image: photo('label-protein-bar.jpg', 'd38bb678b5974fd6cd498f2731da25429ede66b3627e32d430e86159015fdf83') },
  { id: 'label-greek-yogurt', category: 'label', text: 'had about a cup of this with a handful of blueberries', calories: [175, 270],
    image: photo('label-greek-yogurt.jpg', '34d9a8cf7eeb7d7415bc6c2615d9f1448e142c4fda0f119e32b0069dc225899f') },
  { id: 'label-granola-cereal', category: 'label', text: 'one serving of this with a cup of 2% milk', calories: [345, 400],
    image: photo('label-granola-cereal.jpg', 'b1b569d0845ec331cf19d01282e7ba8d244f8936ea018d58d959b68f63e1d22a') },
  { id: 'label-frozen-meal', category: 'label', text: 'ate the whole bowl for lunch', calories: [385, 395],
    image: photo('label-frozen-meal.jpg', '40d431ca7a26b47a0d6f0ca981a01416de5900c82d09478af9f4d57880a5d659') },
]

export interface MealIntakeBenchmarkConfig {
  codexHome: string | null
  env: NodeJS.ProcessEnv
  model: string
  modelProvider: string
}

interface RecordedCommand {
  argv: string[]
  endedAtMs: number
  startedAtMs: number
  status: number | null
}

export interface MealIntakeBenchmarkResult {
  card: unknown
  caseId: string
  category: MealIntakeBenchmarkCase['category']
  codexThreadId: string | null
  commands: Array<{ argv: string, durationMs: number, offsetMs: number, status: number | null }>
  failures: string[]
  mealCalories: number | null
  mealCount: number
  model: string
  passMs: number
  providerEvents: Array<{ kind: string, label: string | null, offsetMs: number, state: string }>
  providerStartOffsetMs: number | null
  reply: string | null
  traces: Record<string, unknown>[]
}

// Records synthetic argv timing and executes the shipped CLI. Like the hosted
// Worker egress intercept, the preload sends only the data API hostname to the
// local labels API; every other request is untouched.
const CLI_WRAPPER = [
  '#!/usr/bin/env node',
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'const { spawnSync } = require("node:child_process");',
  'const startedAtMs = Date.now();',
  'const env = { ...process.env, MURPH_HOSTED_RUNTIME_PROCESS: "1", MURPH_DATA_API_KEY: "local-benchmark-runner" };',
  'const preload = path.join(__dirname, "data-api-egress.mjs");',
  'const result = spawnSync(process.execPath, ["--import", preload, process.env.MURPH_MEAL_INTAKE_CLI, ...process.argv.slice(2)], { env, stdio: "inherit" });',
  'fs.appendFileSync(process.env.MURPH_MEAL_INTAKE_COMMANDS, JSON.stringify({ argv: process.argv.slice(2), startedAtMs, endedAtMs: Date.now(), status: result.status }) + "\\n");',
  'process.exit(result.status ?? 1);',
  '',
].join('\n')

const DATA_API_EGRESS_PRELOAD = [
  'const origin = "http://murph-data-api.worker";',
  'const target = process.env.MURPH_MEAL_INTAKE_DATA_API_PROXY;',
  'const nativeFetch = globalThis.fetch;',
  'globalThis.fetch = (input, init) => {',
  '  const url = input instanceof Request ? input.url : String(input);',
  '  if (!target || !url.startsWith(`${origin}/`)) return nativeFetch(input, init);',
  '  const rewritten = target + url.slice(origin.length);',
  '  return nativeFetch(input instanceof Request ? new Request(rewritten, input) : rewritten, init);',
  '};',
  '',
].join('\n')

export function readMealIntakeBenchmarkEnvironment(env: NodeJS.ProcessEnv = process.env): {
  dataApiProxy: string
  imageDirectory: string
  resultsPath: string | null
} {
  const imageDirectory = env.MURPH_MEAL_INTAKE_BENCH_IMAGE_DIR?.trim()
  const dataApiProxy = env.MURPH_MEAL_INTAKE_BENCH_DATA_API_PROXY?.trim()
  if (!imageDirectory || !dataApiProxy) {
    throw new Error('Set MURPH_MEAL_INTAKE_BENCH_IMAGE_DIR and MURPH_MEAL_INTAKE_BENCH_DATA_API_PROXY for the meal intake benchmark.')
  }
  return { dataApiProxy, imageDirectory, resultsPath: env.MURPH_MEAL_INTAKE_BENCH_RESULTS?.trim() || null }
}

export async function runMealIntakeBenchmarkCase(input: {
  benchmarkCase: MealIntakeBenchmarkCase
  config: MealIntakeBenchmarkConfig
  dataApiProxy: string
  imageDirectory: string
  resultsPath?: string | null
}): Promise<MealIntakeBenchmarkResult> {
  const { benchmarkCase, config } = input
  const image = benchmarkCase.image
    ? await readFile(path.join(input.imageDirectory, benchmarkCase.image.file))
    : null
  if (benchmarkCase.image && image
    && createHash('sha256').update(image).digest('hex') !== benchmarkCase.image.sha256) {
    throw new Error(`Benchmark image ${benchmarkCase.image.file} does not match its recorded sha256.`)
  }
  const root = await mkdtemp(path.join(tmpdir(), 'murph-meal-intake-'))
  try {
    const vault = path.join(root, 'vault')
    const bin = path.join(root, '.local', 'bin')
    const commandLog = path.join(root, 'commands.jsonl')
    await mkdir(bin, { recursive: true })
    await initializeVault({ vaultRoot: vault, timezone: TIME_ZONE })
    await symlink(process.execPath, path.join(bin, 'node'))
    await writeFile(path.join(bin, 'vault-cli'), CLI_WRAPPER, { mode: 0o700 })
    await writeFile(path.join(bin, 'data-api-egress.mjs'), DATA_API_EGRESS_PRELOAD, { mode: 0o600 })
    const env: NodeJS.ProcessEnv = {
      ...config.env,
      HOME: root,
      MURPH_CANONICAL_JOURNEY_CODEX: process.env.MURPH_REAL_CODEX_COMMAND ?? PINNED_CODEX,
      MURPH_MEAL_INTAKE_CLI: CLI_ENTRYPOINT,
      MURPH_MEAL_INTAKE_COMMANDS: commandLog,
      MURPH_MEAL_INTAKE_DATA_API_PROXY: input.dataApiProxy,
      PATH: `${bin}${path.delimiter}${config.env.PATH ?? ''}`,
      VAULT: vault,
    }
    const codexCommand = path.join(bin, 'codex-real')
    await writeFile(codexCommand, canonicalCodexLauncher(env), { mode: 0o700 })
    const now = new Date()
    const localDate = formatLocalDate(now)
    await seedEstablishedMember({ bin, env, now, vault })
    await writeFile(commandLog, '')

    await seedInboundLinqMeal({ benchmarkCase, image, now, vault })
    await saveAssistantAutomationState(vault, {
      autoReply: [{ channel: 'linq', eligibleAfter: null, enabledAt: new Date(now.getTime() - 60_000).toISOString() }],
      updatedAt: new Date(now.getTime() - 60_000).toISOString(),
      version: 1,
    })
    const target = createAssistantModelTarget({
      approvalPolicy: 'never', codexCommand,
      codexHome: config.codexHome ?? config.env.CODEX_HOME ?? null,
      model: config.model, modelProvider: config.modelProvider,
      provider: 'codex-cli', reasoningEffort: 'low', sandbox: 'workspace-write',
    })
    if (!target) throw new Error('Expected a benchmark assistant target.')

    const traces: Record<string, unknown>[] = []
    const providerEvents: MealIntakeBenchmarkResult['providerEvents'] = []
    let codexThreadId: string | null = null
    let providerStartOffsetMs: number | null = null
    const startedAt = Date.now()
    await runAssistantAutomationPass({
      deliveryDispatchMode: 'queue-only',
      drainOutbox: false,
      executionContext: { hosted: { defaultTarget: target, memberId: 'meal-intake-benchmark-member', userEnvKeys: [] } },
      onProviderEvent(event) {
        providerEvents.push({ kind: event.kind, label: event.safeLabel ?? event.label ?? null, offsetMs: Date.now() - startedAt, state: event.state })
      },
      onProviderRequestStarted() { providerStartOffsetMs ??= Date.now() - startedAt },
      onTraceEvent(event) {
        codexThreadId ??= event.codexThreadId
        if (event.rawEvent && typeof event.rawEvent === 'object') {
          traces.push({ ...(event.rawEvent as Record<string, unknown>), benchmarkOffsetMs: Date.now() - startedAt })
        }
      },
      requestId: `meal-intake-benchmark-${benchmarkCase.id}`,
      turnEnvironment: { currentWorkingDirectory: vault, env },
      vault,
    })
    await waitForWarmCodexBackgroundWork()
    const passMs = Date.now() - startedAt

    // The fresh vault has no earlier outbox work, so every intent is this turn's.
    const intents = await listAssistantOutboxIntents(vault)
    const delivered = intents.at(-1) ?? null
    const totals = await readMealNutritionTotals(vault, { from: localDate, to: localDate })
    const mealCount = totals.mealCount - 1
    const mealCalories = totals.totals.calories.total === null ? null : totals.totals.calories.total - SEEDED_BREAKFAST_CALORIES
    const recorded = (await readFile(commandLog, 'utf8')).split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedCommand)
    const failures: string[] = []
    if (mealCount !== 1) failures.push(`expected one new meal, saw ${mealCount}`)
    if (mealCalories === null || mealCalories < benchmarkCase.calories[0] || mealCalories > benchmarkCase.calories[1]) {
      failures.push(`calories ${mealCalories} outside ${benchmarkCase.calories.join('-')}`)
    }
    if (!delivered) failures.push('no reply was staged')

    const result: MealIntakeBenchmarkResult = {
      card: delivered?.card ?? null,
      caseId: benchmarkCase.id,
      category: benchmarkCase.category,
      codexThreadId,
      commands: recorded.map((command) => ({
        argv: command.argv.join(' ').replaceAll(root, '<ROOT>'),
        durationMs: command.endedAtMs - command.startedAtMs,
        offsetMs: command.startedAtMs - startedAt,
        status: command.status,
      })),
      failures,
      mealCalories,
      mealCount,
      model: config.model,
      passMs,
      providerEvents,
      providerStartOffsetMs,
      reply: delivered?.message ?? null,
      traces,
    }
    process.stdout.write(`[meal-intake-speed] ${JSON.stringify(summarizeMealIntakeBenchmarkResult(result))}\n`)
    if (input.resultsPath) await appendFile(input.resultsPath, `${JSON.stringify(result)}\n`)
    return result
  } finally {
    await stopWarmCodexAppServer('meal-intake-benchmark-complete')
    await rm(root, { force: true, recursive: true })
  }
}

export function summarizeMealIntakeBenchmarkResult(result: MealIntakeBenchmarkResult) {
  const actions = result.traces.find((trace) => trace.schema === 'murph.assistant-codex-action-diagnostics.v1') ?? {}
  const completed = result.traces.find((trace) =>
    trace.schema === 'murph.assistant-codex-app-server-timing.v1' && trace.codexTimingStage === 'turn-completed') ?? {}
  return {
    caseId: result.caseId,
    passMs: result.passMs,
    providerStartMs: result.providerStartOffsetMs,
    turnMs: completed.codexTimingTurnCompleteElapsedMs ?? null,
    samples: actions.codexActionUsageSampleCount ?? null,
    actions: actions.codexActionProviderActionCount ?? null,
    webSearches: actions.codexActionWebSearchCount ?? null,
    inputTokens: actions.codexActionFinalInputUnit ?? null,
    commands: result.commands.map((command) => `${command.argv.slice(0, 120)} (${command.durationMs}ms)`),
    mealCalories: result.mealCalories,
    cardKind: (result.card as { kind?: string } | null)?.kind ?? null,
    reply: result.reply,
    failures: result.failures,
  }
}

const SEEDED_BREAKFAST_CALORIES = 250

async function seedEstablishedMember(input: {
  bin: string
  env: NodeJS.ProcessEnv
  now: Date
  vault: string
}): Promise<void> {
  await upsertMemory(input.vault, { section: 'Instructions', text: 'Comfortable with calorie and macro numbers when logging meals.' })
  await upsertMemory(input.vault, { section: 'Context', text: NUTRITION_GOAL_INVITATION_SENT_MEMORY })
  const breakfastAt = new Date(Math.max(
    input.now.getTime() - 3 * 60 * 60_000,
    startOfLocalDay(input.now).getTime() + 60_000,
  ))
  await execFileAsync(path.join(input.bin, 'vault-cli'), [
    'meal', 'add', '--format', 'json',
    '--note', 'Greek yogurt with berries and granola',
    '--occurred-at', breakfastAt.toISOString(),
    '--nutrition-calories', String(SEEDED_BREAKFAST_CALORIES),
    '--nutrition-protein-grams', '20', '--nutrition-carbs-grams', '30',
    '--nutrition-fat-grams', '5', '--nutrition-fiber-grams', '4',
    '--nutrition-source', 'user', '--nutrition-confidence', 'high',
  ], { cwd: input.vault, env: input.env, timeout: 60_000 })
}

async function seedInboundLinqMeal(input: {
  benchmarkCase: MealIntakeBenchmarkCase
  image: Buffer | null
  now: Date
  vault: string
}): Promise<string> {
  const { benchmarkCase, image, now, vault } = input
  const receivedAt = now.toISOString()
  const fileName = 'IMG_4821.jpg'
  const captureId = `cap_meal_intake_${benchmarkCase.id.replaceAll('-', '_')}`
  const text = benchmarkCase.text
  const event = await upsertAssistantInputEvent({ vault, event: {
    content: {
      attachmentDescriptors: image ? [{ attachmentId: 'attachment-meal-photo', contentType: 'image/jpeg', fileName, kind: 'image', sizeBytes: image.length }] : [],
      text,
      transcriptText: text,
      userMessageContent: text ? [{ text, type: 'text' }] : null,
    },
    conversation: { accountId: 'meal-intake-account', actorId: 'meal-intake-actor', actorIsSelf: false, source: 'linq', threadId: THREAD_ID, threadIsDirect: true },
    occurredAt: receivedAt,
    receivedAt,
    replyTarget: { channel: 'linq', messageId: `meal-intake-${benchmarkCase.id}`, threadId: THREAD_ID },
    sourceMetadata: {
      externalThreadRouteAuthorityPresent: true, kind: 'linq', partCount: (image ? 1 : 0) + (text ? 1 : 0),
      reactionEligible: true, replyToMessageId: null, senderHandle: '+15550000000', service: 'iMessage',
    },
    sourceRef: {
      dedupeKey: `meal-intake-${benchmarkCase.id}`, eventId: `meal-intake-event-${benchmarkCase.id}`,
      itemId: `meal-intake-item-${benchmarkCase.id}`, kind: 'hosted-mailbox', lane: 'conversation', laneSeq: '1',
      payloadSchema: 'payload-schema', payloadSource: 'inline', source: 'hosted-mailbox', wakeSchema: 'wake-schema',
    },
  } })
  if (!image) return event.inputId
  const rawPath = `raw/inbox/${captureId}/attachments/${fileName}`
  await mkdir(path.dirname(path.join(vault, rawPath)), { recursive: true })
  await writeFile(path.join(vault, rawPath), image)
  await updateAssistantInputProjection({ inputId: event.inputId, projection: { captureId, status: 'succeeded' }, vault })
  await updateAssistantInputAttachmentEvidence({ inputId: event.inputId, vault, attachmentEvidence: {
    attachments: [{
      byteSize: image.length, derived: null, descriptorAttachmentId: 'attachment-meal-photo', fileName,
      inlineFragments: [], kind: 'image', mime: 'image/jpeg', ordinal: 1, parseState: 'succeeded',
      raw: { byteSize: image.length, kind: 'vault-relative-file', mediaType: 'image/jpeg', path: rawPath,
        sha256: createHash('sha256').update(image).digest('hex') },
      sourceAttachmentId: 'attachment-meal-photo',
    }],
    optionalInboxCaptureId: captureId, reasonCode: null, source: 'hosted-inbox-projection',
    status: 'available', updatedAt: receivedAt,
  } })
  return event.inputId
}

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: TIME_ZONE, year: 'numeric' }).format(date)
}

function startOfLocalDay(date: Date): Date {
  const [year, month, day] = formatLocalDate(date).split('-').map(Number)
  const utcMidnight = Date.UTC(year!, month! - 1, day!)
  const offsetMs = utcMidnight - new Date(new Date(utcMidnight).toLocaleString('en-US', { timeZone: TIME_ZONE })).getTime()
  return new Date(utcMidnight + offsetMs)
}
