import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { expect, vi } from 'vitest'
import { addDaysToIsoDate, resolveFloatingIsoTimestampInTimeZone, toLocalDayKey } from '@murphai/contracts'
import { listAutomations, readMemoryDocument, showAutomation } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import * as codex from '../../src/assistant-codex.js'
import { getAssistantCronJob, listAssistantCronRuns, processDueAssistantCronJobsLocal, reconcileAssistantCronDeliveryIntent } from '../../src/assistant/cron.js'
import type { AssistantHostedAutomationToolRequest } from '../../src/assistant/execution-context.js'
import { listAssistantOutboxIntents, markAssistantOutboxIntentSentById } from '../../src/assistant/outbox.js'
import { createCanonicalLiveFixture, createCanonicalReminderAutomationPort, type CanonicalLiveConfig } from './canonical-live-journeys.js'

const SPANISH = 'Hoy he pasado la mañana ordenando mis libros. Me gusta tener una mañana tranquila en casa.'
const ENGLISH = 'I spent the morning arranging my books. I enjoy having a quiet morning at home.'
const SPANISH_REMINDER = 'Recuérdame mañana a las ocho de la mañana que beba un vaso de agua.'
const ENGLISH_REMINDER = 'Remind me tomorrow at eight in the morning to drink a glass of water.'

export const REMINDER_LANGUAGE_CASES = [
  { id: 'spanish', timezone: 'America/Mexico_City', opening: SPANISH, request: SPANISH_REMINDER, language: 'Spanish', content: /agua/iu },
  { id: 'polish', timezone: 'Europe/Warsaw', opening: 'Dziś rano układałem książki na półce. Lubię spokojne poranki w domu.', request: 'Przypomnij mi jutro o ósmej rano, żebym wypił szklankę wody.', language: 'Polish', content: /wod[ayę]/iu },
  { id: 'japanese', timezone: 'Asia/Tokyo', opening: '今日は朝から本棚を整理していました。家で静かな朝を過ごすのが好きです。', request: '明日の朝8時にコップ一杯の水を飲むようにリマインドして。', language: 'Japanese', content: /水/u },
  { id: 'english-warsaw', timezone: 'Europe/Warsaw', opening: ENGLISH, request: ENGLISH_REMINDER, language: 'English', content: /water/iu },
  { id: 'english-mexico', timezone: 'America/Mexico_City', opening: ENGLISH, request: ENGLISH_REMINDER, language: 'English', content: /water/iu },
  { id: 'spanish-to-english', timezone: 'America/Mexico_City', opening: SPANISH, request: ENGLISH_REMINDER, language: 'English', content: /water/iu },
  { id: 'english-to-spanish', timezone: 'Europe/Warsaw', opening: ENGLISH, request: SPANISH_REMINDER, language: 'Spanish', content: /agua/iu },
] as const

type LanguageCase = typeof REMINDER_LANGUAGE_CASES[number]

export async function runReminderLanguageJourney(config: CanonicalLiveConfig, scenario: LanguageCase): Promise<void> {
  const fixture = await createCanonicalLiveFixture({ ...config, timezone: scenario.timezone }, 'linq')
  const nativeExecute = codex.executeCodexAppServerTurn
  const providerInputs: Array<{ model: string | null; resumeSessionId: string | null; baseInstructions: string | null; developerInstructions: string | null; prompt: string; reply?: string; threadId?: string | null }> = []
  const observer = vi.spyOn(codex, 'executeCodexAppServerTurn').mockImplementation(async input => {
    const evidence: typeof providerInputs[number] = {
      model: input.model ?? null, resumeSessionId: input.resumeSessionId ?? null,
      baseInstructions: input.baseInstructions ?? null, developerInstructions: input.developerInstructions ?? null,
      prompt: input.prompt,
    }
    providerInputs.push(evidence)
    const result = await nativeExecute(input)
    evidence.reply = result.finalMessage
    evidence.threadId = result.threadId
    return result
  })
  const automationRequests: AssistantHostedAutomationToolRequest[] = []
  const models: (string | null)[] = []
  const evidence: Record<string, unknown> = { scenario: scenario.id, timezone: scenario.timezone, expectedLanguage: scenario.language, providerInputs }
  try {
    expect(config.model).toBe('gpt-6.1-sol')
    expect((await readMemoryDocument(fixture.vault)).records).toEqual([])
    const executionContext = { hosted: {
      automationTool: createCanonicalReminderAutomationPort(fixture.vault, automationRequests),
      memberId: 'synthetic-language-member', userEnvKeys: [],
      defaultTarget: createAssistantModelTarget({
        provider: 'codex-cli', model: config.model, modelProvider: config.modelProvider,
        codexCommand: fixture.codexCommand, codexHome: fixture.codexHome,
        approvalPolicy: 'never', sandbox: 'workspace-write', reasoningEffort: 'low',
      }),
      usageRecorder: { async recordUsage(record: { requestedModel: string | null }) { models.push(record.requestedModel) } },
      resolveScheduledLinqRoute: async (input: { target: string }) => ({ target: input.target, conversationThreadId: input.target, threadIsDirect: true }),
    } }
    // Keep the natural request away from the production late-night date clarification window.
    const authorDay = toLocalDayKey(new Date(), scenario.timezone)
    const authorInstant = resolveFloatingIsoTimestampInTimeZone(`${authorDay}T12:00:00`, scenario.timezone)?.timestamp
    if (!authorInstant) throw new Error('Expected a local noon instant.')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(authorInstant))
    evidence.authorInstant = authorInstant
    const opening = await fixture.message(scenario.opening, { executionContext })
    evidence.openingReply = opening.response
    evidence.memoryAfterOpening = (await readMemoryDocument(fixture.vault)).records
    const authored = await fixture.message(scenario.request, { executionContext, sessionId: opening.session.sessionId })
    evidence.authoringReply = authored.response
    const memoryBeforeFire = (await readMemoryDocument(fixture.vault)).records
    evidence.memoryBeforeFire = memoryBeforeFire
    const records = await listAutomations({ vaultRoot: fixture.vault })
    expect(records.items).toHaveLength(1)
    const reminder = records.items[0]!
    evidence.saved = reminder
    expect(reminder.assistantTargetOverride?.model).toBe('gpt-6-luna')
    expect(automationRequests.filter(request => request.action === 'save')).toHaveLength(1)
    const job = await getAssistantCronJob(fixture.vault, reminder.automationId)
    expect(job.state.nextRunAt).toBeTruthy()
    const due = job.state.nextRunAt!
    const tomorrow = addDaysToIsoDate(toLocalDayKey(new Date(), scenario.timezone), 1)
    expect(toLocalDayKey(new Date(due), scenario.timezone)).toBe(tomorrow)
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: scenario.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(due))).toBe('08:00')
    evidence.due = due

    // Advance only Date in the host. Real I/O timers and the live provider stay real.
    // Restart the owned app-server to exercise persisted cross-day continuity.
    await codex.stopWarmCodexAppServer('reminder-language-next-day')
    vi.setSystemTime(new Date(due))
    models.length = 0
    const providerCountBeforeFire = providerInputs.length
    const fired = await processDueAssistantCronJobsLocal({
      deliveryDispatchMode: 'queue-only', executionContext, limit: 1,
      turnEnvironment: { currentWorkingDirectory: fixture.vault, env: fixture.env }, vault: fixture.vault,
    })
    evidence.execution = fired
    expect(fired.failed, (await getAssistantCronJob(fixture.vault, reminder.automationId)).state.lastError ?? undefined).toBe(0)
    expect(fired.processed).toBe(1)
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(model => model === 'gpt-6-luna')).toBe(true)
    const scheduledInputs = providerInputs.slice(providerCountBeforeFire)
    expect(scheduledInputs.length).toBeGreaterThan(0)
    for (const input of scheduledInputs) {
      const full = [input.baseInstructions, input.developerInstructions, input.prompt].join('\n')
      expect(full).toContain("Match replies, including voice memo text, to the user's conversational language")
      expect(full).toContain(reminder.instructions)
      if (input.resumeSessionId === null) {
        expect(input.prompt).toContain(scenario.opening)
        expect(input.prompt).toContain(scenario.request)
      }
      for (const record of memoryBeforeFire) expect(full).toContain(record.text)
    }
    const intents = await listAssistantOutboxIntents(fixture.vault)
    expect(intents).toHaveLength(1)
    const intent = intents[0]!
    evidence.deliveredText = intent.message
    evidence.scheduledModels = models
    evidence.resumed = scheduledInputs.map(input => input.resumeSessionId !== null)
    evidence.historyReconstructed = scheduledInputs.map(input => input.prompt.includes(scenario.opening) && input.prompt.includes(scenario.request))
    expect(intent.channel).toBe('linq')
    expect(intent.status).toBe('pending')
    const delivered = await markAssistantOutboxIntentSentById({
      intentId: intent.intentId, vault: fixture.vault,
      delivery: { channel: 'linq', idempotencyKey: intent.deliveryIdempotencyKey, messageLength: intent.message.length,
        providerMessageId: 'synthetic-language-receipt', providerThreadId: reminder.route.threadId!,
        sentAt: due, target: reminder.route.deliveryTarget!, targetKind: 'thread' },
    })
    expect(delivered).toBeTruthy()
    if (!delivered) throw new Error('Synthetic delivery receipt was not recorded.')
    await reconcileAssistantCronDeliveryIntent({ intent: delivered, vault: fixture.vault })
    const completed = await showAutomation({ vaultRoot: fixture.vault, automationId: reminder.automationId })
    expect(completed?.status).toBe('archived')
    const history = await listAssistantCronRuns({ vault: fixture.vault, job: job.jobId })
    expect(history.runs[0]?.outcome).toBe('delivered')
    expect(history.runs[0]?.response).toBe(intent.message)
    evidence.completed = true
    process.stdout.write(`[reminder-language] ${JSON.stringify({ scenario: scenario.id, timezone: scenario.timezone,
      memory: memoryBeforeFire.map(record => record.text), instructions: reminder.instructions,
      model: reminder.assistantTargetOverride?.model, delivered: intent.message, resumed: evidence.resumed })}\n`)
    expect(intent.message).toMatch(scenario.content)
    expect(intent.message).not.toMatch(/gpt-|Luna|automation|scheduled occurrence|memory note/iu)
    if (scenario.language !== 'English') expect(intent.message).not.toMatch(/time to|drink (?:a|some)|remember to|here.s your reminder/iu)
    if (scenario.language === 'Japanese') expect(intent.message).toMatch(/[ぁ-んァ-ン]/u)
    if (scenario.id.startsWith('english-') && scenario.language === 'English') {
      expect(memoryBeforeFire.some(record => /observed conversational language/iu.test(record.text))).toBe(false)
    }
  } finally {
    vi.useRealTimers()
    observer.mockRestore()
    const outputDirectory = process.env.MURPH_REMINDER_LANGUAGE_EVIDENCE_DIR
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true })
      const safe = JSON.stringify(evidence, null, 2).replaceAll(fixture.root, '<FIXTURE_ROOT>').replaceAll(homedir(), '<HOME_DIR>')
      await writeFile(path.join(outputDirectory, `${scenario.id}.json`), safe + '\n')
    }
    await fixture.close()
  }
}
