import { loadDeviceSyncEnvironment } from "./config.ts";
import { formatDeviceSyncStartupError } from "./errors.ts";
import { startDeviceSyncHttpServer } from "./http.ts";
import { createDeviceSyncService } from "./service.ts";

async function main(): Promise<void> {
  const environment = loadDeviceSyncEnvironment(process.env);
  const service = createDeviceSyncService(environment.service);
  service.start();

  const server = await startDeviceSyncHttpServer({
    service,
    config: environment.http,
  });

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
