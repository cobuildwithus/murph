import { Cli } from 'incur'
import { describe, expect, it } from 'vitest'

import { registerRouteCommands } from '../src/commands/route.js'

describe('route resolve-address command', () => {
  it('is discoverable with bounded address-resolution inputs', async () => {
    const cli = Cli.create('vault-cli', {
      description: 'test CLI',
    })
    registerRouteCommands(cli)
    const output: string[] = []

    await cli.serve(['--llms-full', '--format', 'json'], {
      exit: () => {},
      stdout(chunk) {
        output.push(chunk)
      },
    })

    const manifest = JSON.parse(output.join('')) as {
      commands?: Array<{
        name?: string
        schema?: {
          args?: {
            properties?: Record<string, {
              maxLength?: number
              minLength?: number
            }>
          }
          options?: {
            properties?: Record<string, unknown>
          }
        }
      }>
    }
    const command = manifest.commands?.find(
      (candidate) => candidate.name === 'route resolve-address',
    )

    expect(command).toBeDefined()
    expect(command?.schema?.args?.properties?.query).toMatchObject({
      maxLength: 256,
      minLength: 1,
    })
    expect(command?.schema?.options?.properties).toHaveProperty('country')
    expect(command?.schema?.options?.properties).toHaveProperty('language')
  })
})
