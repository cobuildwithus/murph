import { loadDeviceSyncEnvironment } from "./config.js";
import { formatDeviceSyncStartupError } from "./errors.js";
import { startDeviceSyncHttpServer } from "./http.js";
import { createDeviceSyncService } from "./service.js";

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
