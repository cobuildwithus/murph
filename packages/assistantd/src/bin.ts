#!/usr/bin/env node
import { loadAssistantdEnvironment, loadAssistantdEnvFiles } from './config.js'
import { startAssistantHttpServer } from './http.js'
import { createAssistantLocalService } from './service.js'

async function main(): Promise<void> {
  process.env.MURPH_ASSISTANTD_DISABLE_CLIENT = '1'
  loadAssistantdEnvFiles()
  const env = loadAssistantdEnvironment()
  const service = createAssistantLocalService(env.vaultRoot)
  const handle = await startAssistantHttpServer({
    controlToken: env.controlToken,
    host: env.host,
    port: env.port,
    service,
  })

  console.log(
    JSON.stringify({
      assistantd: {
        baseUrl: handle.address.baseUrl,
        host: handle.address.host,
        port: handle.address.port,
        vaultBound: true,
      },
    }),
  )

  const shutdown = async () => {
    await handle.close().catch(() => undefined)
    process.exit(0)
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
