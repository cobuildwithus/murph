import { buildAssistantSystemPrompt } from "../src/assistant/system-prompt.js"
import { describe, expect, it, vi } from 'vitest'
import { executeDeviceDynamicTool, readDeviceDynamicToolRequest, MURPH_DEVICE_TOOL } from '../src/assistant-codex/dynamic-tools/device.js'
import type { WearableHapticAuthority } from '@murphai/hosted-execution/wearable-haptics'

const action = { action: 'haptic', wearable: 'whoop', operation: 'buzz' } as const
const privateAuthority = { kind: 'accepted_input', assistantInputId: 'ain_' + 'a'.repeat(32) } as const

describe('wrist haptic tool boundary', () => {
  it.each(['whoop', 'garmin'] as const)('accepts only immediate closed operations for %s', (wearable) => {
    expect(readDeviceDynamicToolRequest({ tool: 'device', arguments: { ...action, wearable } })).toEqual({ kind: 'device', request: { ...action, wearable } })
    for (const extra of [{ delayMinutes: 10 }, { memberId: 'other' }, { rawCommand: '19' }, { duration: 600 }]) {
      expect(readDeviceDynamicToolRequest({ tool: 'device', arguments: { ...action, wearable, ...extra } })?.kind).toBe('invalid-device-arguments')
    }
  })
  it('rejects effect without host-owned private or scheduled authority', async () => {
    const request = vi.fn()
    const result = await executeDeviceDynamicTool({ deviceTool: { request }, request: { kind: 'device', request: action } })
    expect(request).not.toHaveBeenCalled()
    expect(result.rpcResult.contentItems[0]?.text).toMatch(/private member or scheduled reminder authority/)
  })
  it.each<WearableHapticAuthority>([
    privateAuthority,
    { kind: 'automation_occurrence', automationId: 'synthetic-meditation', occurrenceAt: '2026-10-01T12:10:00.000Z' },
  ])('forwards authority and preserves queued truth for $kind', async (authority) => {
    const request = vi.fn(async () => ({ ...action, status: 'queued' as const }))
    const result = await executeDeviceDynamicTool({ hapticAuthority: authority, deviceTool: { request }, request: { kind: 'device', request: action } })
    expect(request).toHaveBeenCalledExactlyOnceWith(action, { hapticAuthority: authority, signal: null })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual({ ...action, status: 'queued' })
  })
  it.each(['app_unreachable', 'device_disconnected', 'busy'] as const)('preserves the %s failure reason through the model boundary', async (unavailableReason) => {
    const request = vi.fn(async () => ({ ...action, status: 'unavailable' as const, unavailableReason }))
    const result = await executeDeviceDynamicTool({ hapticAuthority: privateAuthority, deviceTool: { request }, request: { kind: 'device', request: action } })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual({ ...action, status: 'unavailable', unavailableReason })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('exposes app contact independently of sync or wearable effects', async () => {
    const response = { action: 'companion_status' as const, status: 'recently_active' as const, lastContactAt: '2026-10-01T12:00:00.000Z', lastForegroundAt: null }
    expect(readDeviceDynamicToolRequest({ tool: 'device', arguments: { action: 'companion_status' } })?.kind).toBe('device')
    const result = await executeDeviceDynamicTool({ deviceTool: { request: async () => response }, request: { kind: 'device', request: { action: 'companion_status' } } })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual(response)
  })
  it('does not confirm a receipt for the wrong band', async () => {
    const request = vi.fn(async () => ({ ...action, wearable: 'garmin' as const, status: 'acknowledged' as const }))
    const result = await executeDeviceDynamicTool({ hapticAuthority: privateAuthority, deviceTool: { request }, request: { kind: 'device', request: action } })
    expect(result.rpcResult.contentItems[0]?.text).toMatch(/Do not retry the buzz/)
    expect(result.rpcResult.contentItems[0]?.text).not.toMatch(/acknowledged/)
  })
  it('uses the runtime scheduler and never promises background delivery', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null, assistantKnowledgeToolsAvailable: false, assistantHostedAutomationAvailable: true,
      assistantHostedDeviceConnectAvailable: true, assistantHostedDeviceConnectProviders: [],
      channel: 'linq', cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
      conversationScope: 'direct', currentLocalDate: '2026-10-01',
      currentInstant: '2026-10-01T12:00:00.000Z', currentTimeZone: 'UTC',
      hostedRuntime: true, modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false,
      turnTrigger: 'automation-auto-reply',
    })
    expect(prompt).not.toContain('Scheduled automation changes are unavailable in this turn')
    expect(prompt).toContain('murph.automation')
    expect(MURPH_DEVICE_TOOL.description).toContain('existing automation scheduler')
    expect(MURPH_DEVICE_TOOL.description).toContain('wait under one minute')
    expect(MURPH_DEVICE_TOOL.description).toContain('sleep for that long in this turn')
    expect(MURPH_DEVICE_TOOL.description).toContain('testing or troubleshooting delivery, wait a few seconds and repeat it once')
    expect(MURPH_DEVICE_TOOL.description).toContain('do not also buzz now as a test unless asked')
    expect(MURPH_DEVICE_TOOL.description).not.toMatch(/For a delay, use the existing automation scheduler/u)
    expect(MURPH_DEVICE_TOOL.description).toContain('can deliver while Murph is in the background or the phone is locked')
    expect(MURPH_DEVICE_TOOL.description).toContain('when explaining delivery call it best effort, never guaranteed')
    expect(MURPH_DEVICE_TOOL.description).toContain('Older apps need Murph open')
    expect(MURPH_DEVICE_TOOL.description).toContain('When a scheduled buzz fires, still reply with one short status line')
    expect(MURPH_DEVICE_TOOL.description).toContain('background delivery works best with Murph notifications on')
    expect(MURPH_DEVICE_TOOL.description).not.toMatch(/requires Murph open|delivery needs Murph open/u)
    expect(MURPH_DEVICE_TOOL.description).toContain('read existing reminders')
    expect(MURPH_DEVICE_TOOL.description).toContain('after the member tells you they are starting')
    expect(MURPH_DEVICE_TOOL.description).toContain('does not authorize creating or changing a reminder')
    expect(MURPH_DEVICE_TOOL.description).toContain('Settings > Connect device')
    expect(MURPH_DEVICE_TOOL.description).toContain('Fulfill the requested reminder first')
    expect(MURPH_DEVICE_TOOL.description).toContain('An offer authorizes no buzz, connection, or extra timer')
    expect(MURPH_DEVICE_TOOL.description).toContain('never pitch Garmin as silent')
    expect(MURPH_DEVICE_TOOL.description).toContain('repeat a declined offer')
  })
})
