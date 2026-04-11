import { loadDeviceSyncEnvironment } from "./config.ts";
import { formatDeviceSyncStartupError } from "./errors.ts";
import { startDeviceSyncHttpServer } from "./http.ts";
import { createDeviceSyncService } from "./service.ts";

async function main(): Promise<void> {
  const environment = loadDeviceSyncEnvironment(process.env);
  const service = createDeviceSyncService(environment.service);
  const server = await (async () => {
    let startedServer: Awaited<ReturnType<typeof startDeviceSyncHttpServer>> | null = null;

    try {
      startedServer = await startDeviceSyncHttpServer({
        service,
        config: environment.http,
      });
      service.start();
      return startedServer;
    } catch (error) {
      let rollbackError: unknown = null;

      if (startedServer) {
        try {
          await startedServer.close();
        } catch (closeError) {
          rollbackError = closeError;
        }
      }

      service.close();

      if (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Device sync startup failed and could not fully roll back the HTTP server.",
        );
      }

      throw error;
    }
  })();

  const shutdown = async () => {
    service.stop();
    await server.close();
    service.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

void main().catch((error) => {
  console.error(formatDeviceSyncStartupError(error));
  process.exitCode = 1;
});
