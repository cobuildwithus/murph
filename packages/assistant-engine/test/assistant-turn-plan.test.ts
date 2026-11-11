import { describe, expect, it } from 'vitest'

import {
  HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY,
  resolveAssistantRequestedWorkingDirectory,
} from '../src/assistant/turn-plan.js'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.js'

describe('assistant turn plan', () => {
  it('uses a stable provider-visible cwd for hosted Linux turns restored at process cwd', () => {
    expect(
      resolveAssistantRequestedWorkingDirectory(
        createMessageInput({
          executionContext: {
            hosted: {
              memberId: 'member_test',
              userEnvKeys: [],
            },
          },
          vault: '/tmp/hosted-runner-launch-alpha',
        }),
        {
          currentWorkingDirectory: '/tmp/hosted-runner-launch-alpha',
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: '1',
          },
          platform: 'linux',
        },
      ),
    ).toBe(HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY)
  })

  it.each([undefined, '/tmp/hosted-runner-launch-alpha', '/workspace/explicit'])(
    'anchors recap shows to the concrete vault when explicit cwd is %s',
    workingDirectory => {
      const vault = '/tmp/hosted-runner-launch-alpha'
      expect(resolveAssistantRequestedWorkingDirectory(createMessageInput({
        vault, workingDirectory,
        executionContext: { hosted: {
          memberId: 'synthetic-room', userEnvKeys: [],
          gameRecapScope: { gameId: 'synthetic-game', eventId: 'synthetic-recap', pairFingerprint: 'synthetic-pair', show: true },
        } },
      }), { currentWorkingDirectory: vault, env: { MURPH_HOSTED_RUNTIME_PROCESS: '1' }, platform: 'linux' })).toBe(vault)
    },
  )

  it('keeps plain and group recap turns on the stable hosted cwd', () => {
    const vault = '/tmp/hosted-runner-launch-alpha'
    expect(resolveAssistantRequestedWorkingDirectory(createMessageInput({
      vault,
      executionContext: { hosted: {
        memberId: 'synthetic-room', userEnvKeys: [],
        gameRecapScope: { gameId: 'synthetic-game', eventId: 'synthetic-recap', pairFingerprint: 'synthetic-pair', show: false },
      } },
    }), { currentWorkingDirectory: vault, env: { MURPH_HOSTED_RUNTIME_PROCESS: '1' }, platform: 'linux' })).toBe(HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY)
  })

  it('honors explicit assistant working directories', () => {
    expect(
      resolveAssistantRequestedWorkingDirectory(
        createMessageInput({
          executionContext: {
            hosted: {
              memberId: 'member_test',
              userEnvKeys: [],
            },
          },
          vault: '/tmp/hosted-runner-launch-alpha',
          workingDirectory: '  /workspace/explicit  ',
        }),
        {
          currentWorkingDirectory: '/tmp/hosted-runner-launch-alpha',
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: '1',
          },
          platform: 'linux',
        },
      ),
    ).toBe('/workspace/explicit')
  })

  it('stabilizes hosted Linux cwd when callers explicitly pass the vault cwd', () => {
    expect(
      resolveAssistantRequestedWorkingDirectory(
        createMessageInput({
          executionContext: {
            hosted: {
              memberId: 'member_test',
              userEnvKeys: [],
            },
          },
          vault: '/tmp/hosted-runner-launch-alpha',
          workingDirectory: '/tmp/hosted-runner-launch-alpha',
        }),
        {
          currentWorkingDirectory: '/tmp/hosted-runner-launch-alpha',
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: '1',
          },
          platform: 'linux',
        },
      ),
    ).toBe(HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY)
  })

  it('keeps the vault fallback outside hosted Linux restored-cwd invocations', () => {
    const hostedInput = createMessageInput({
      executionContext: {
        hosted: {
          memberId: 'member_test',
          userEnvKeys: [],
        },
      },
      vault: '/tmp/hosted-runner-launch-alpha',
    })

    expect(
      resolveAssistantRequestedWorkingDirectory(hostedInput, {
        currentWorkingDirectory: '/tmp/hosted-runner-launch-alpha',
        env: {},
        platform: 'linux',
      }),
    ).toBe('/tmp/hosted-runner-launch-alpha')
    expect(
      resolveAssistantRequestedWorkingDirectory(hostedInput, {
        currentWorkingDirectory: '/tmp/hosted-runner-launch-alpha',
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
        },
        platform: 'darwin',
      }),
    ).toBe('/tmp/hosted-runner-launch-alpha')
    expect(
      resolveAssistantRequestedWorkingDirectory(hostedInput, {
        currentWorkingDirectory: '/tmp/other-launch-root',
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
        },
        platform: 'linux',
      }),
    ).toBe('/tmp/hosted-runner-launch-alpha')
    expect(
      resolveAssistantRequestedWorkingDirectory(hostedInput, {
        currentWorkingDirectory: null,
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
        },
        platform: 'linux',
      }),
    ).toBe('/tmp/hosted-runner-launch-alpha')
    expect(
      resolveAssistantRequestedWorkingDirectory(
        createMessageInput({
          executionContext: null,
          vault: '/tmp/local-vault',
        }),
        {
          currentWorkingDirectory: '/tmp/local-vault',
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: '1',
          },
          platform: 'linux',
        },
      ),
    ).toBe('/tmp/local-vault')
  })
})

function createMessageInput(
  input: Partial<AssistantMessageInput> & Pick<AssistantMessageInput, 'vault'>,
): AssistantMessageInput {
  return {
    prompt: 'hello',
    ...input,
  }
}
