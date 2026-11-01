import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listPendingAssistantRuntimeIssueRecords } from '@murphai/runtime-state/node'
import { executeCodexAppServerTurn, resolveMurphDynamicTools, stopWarmCodexAppServer } from '../../src/assistant-codex.js'
import { flushPendingAssistantRuntimeIssueWrites, recordAssistantRuntimeIssueInputsBestEffort } from '../../src/assistant/issue-reporting.js'

// Fake only the external app-server protocol and hosted HTTP port. The actual
// tool dispatcher, per-turn collector, sanitizer and pending-file writer run.
async function produceLatePhoneFailure(status: number) {
  const vault = await mkdtemp(path.join(tmpdir(), 'phone-failure-producer-'))
  let phoneStarts = 0
  const command = path.join(vault, 'scripted-codex.cjs')
  await writeFile(command, `#!/usr/bin/env node
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let next = 0;
function tool() {
  next++;
  send({ id: 'tool-' + next, method: 'item/tool/call', params: {
    namespace: 'murph', threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'call-' + next,
    tool: next <= 8 ? 'computer_open' : 'create_phone_call',
    arguments: next <= 8 ? { startUrl: null } : {
      allowTransferToUser: false, callerName: 'Murph', goal: 'Confirm office hours.',
      instructions: ['Ask for opening time.'], shareableFacts: {},
      successCriteria: 'Opening time confirmed.', timeZone: 'UTC',
      to: { label: 'Synthetic office', phoneNumber: '+12025550123' }
    }
  }});
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  else if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'synthetic-thread' } } });
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'synthetic-turn' } } });
    send({ method: 'turn/started', params: { turn: { id: 'synthetic-turn' } } });
    tool();
  } else if (String(message.id).startsWith('tool-')) {
    if (next < 9) tool();
    else {
      send({ method: 'item/completed', params: { item: { id: 'reply', type: 'agentMessage', text: 'The call could not start.' } } });
      send({ method: 'turn/completed', params: { turn: { id: 'synthetic-turn', status: 'completed' } } });
    }
  }
});
`, { mode: 0o700 })
  try {
    const result = await executeCodexAppServerTurn({
      approvalPolicy: 'never', codexCommand: command, codexHome: vault,
      dynamicTools: resolveMurphDynamicTools({ computerToolsAvailable: true, phoneCallsAvailable: true }),
      env: { PATH: process.env.PATH ?? '/usr/bin', CODEX_HOME: vault },
      fetchImpl: async () => new Response('Synthetic backend unavailable', { status: 503 }),
      hostedToolContext: {
        computerToolsAvailable: true, currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [], vaultFileSendAvailable: false,
        sendVaultFile: async () => { throw new Error('Unexpected file send') },
        currentUserActionScope: () => ({
          acceptedInputIds: ['synthetic-input'], conversationId: 'synthetic-conversation',
          conversationScope: 'direct', inboundMailboxItemIds: ['synthetic-mailbox'],
          originSessionId: 'synthetic-session', recipientKey: 'synthetic-recipient',
          resultNotificationChannel: 'linq',
        }),
        phoneCalls: { start: async () => {
          phoneStarts++
          throw Object.assign(new Error('Synthetic phone start HTTP failure'), { status })
        } },
      },
      prompt: 'Run the synthetic tool failure scenario.', sandbox: 'workspace-write', workingDirectory: vault,
    })
    recordAssistantRuntimeIssueInputsBestEffort({
      issues: result.runtimeIssueInputs, vault,
      policy: { environment: 'hosted', surface: null, privateIssueCaptureEnabled: true },
    })
    await flushPendingAssistantRuntimeIssueWrites()
    assert.equal(phoneStarts, 1)
    assert.equal(result.runtimeIssueInputs.length, 9)
    assert(result.runtimeIssueInputs.slice(0, 8).every(issue => issue.operation === 'computer-open'))
    assert(result.runtimeIssueInputs.slice(0, 8).every(issue => issue.details?.failureReason === 'reported_failure'
      && issue.details.errorCategory === 'unavailable'))
    return await listPendingAssistantRuntimeIssueRecords({ vault })
  } finally {
    await stopWarmCodexAppServer('phone-failure-producer-cleanup')
    await rm(vault, { recursive: true, force: true })
  }
}

const status = Number(process.argv[2])
assert(status === 403 || status === 500)
process.stdout.write(JSON.stringify(await produceLatePhoneFailure(status)))
