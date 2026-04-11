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

  let exitRequested = false;
  let shutdownPromise: Promise<number> | null = null;

  const shutdown = (): Promise<number> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      const shutdownErrors: unknown[] = [];

      try {
        service.stop();
      } catch (error) {
        shutdownErrors.push(error);
      }

      try {
        await server.close();
      } catch (error) {
        shutdownErrors.push(error);
      }

      try {
        service.close();
      } catch (error) {
        shutdownErrors.push(error);
      }

      if (shutdownErrors.length === 1) {
        throw shutdownErrors[0];
      }

      if (shutdownErrors.length > 1) {
        throw new AggregateError(
          shutdownErrors,
          "Device sync shutdown failed.",
        );
      }
    })().then(
      () => 0,
      (error) => {
        console.error(formatDeviceSyncStartupError(error));
        return 1;
      },
    );

    return shutdownPromise;
  };

  const requestExit = () => {
    if (exitRequested) {
      return;
    }

    exitRequested = true;
    void shutdown().then((exitCode) => process.exit(exitCode));
  };

  process.once("SIGINT", requestExit);
  process.once("SIGTERM", requestExit);
}

void main().catch((error) => {
  console.error(formatDeviceSyncStartupError(error));
  process.exitCode = 1;
});
