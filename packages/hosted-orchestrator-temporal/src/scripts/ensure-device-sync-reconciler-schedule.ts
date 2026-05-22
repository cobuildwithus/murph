import {
  ensureHostedDeviceSyncReconcilerSchedule,
  readHostedDeviceSyncReconcilerScheduleConfig,
} from "../client/device-sync-reconciler-schedule.js";
import {
  createHostedRuntimeTemporalClient,
} from "../client/temporal-client.js";
import {
  readHostedRuntimeTemporalEnvironment,
} from "../temporal-env.js";

const config = readHostedDeviceSyncReconcilerScheduleConfig();

const environment = readHostedRuntimeTemporalEnvironment();
const client = await createHostedRuntimeTemporalClient({
  address: environment.address,
  apiKey: environment.apiKey,
  namespace: environment.namespace,
  tls: environment.tls,
});

const result = await ensureHostedDeviceSyncReconcilerSchedule({
  client,
  config: {
    ...config,
    taskQueue: environment.taskQueue,
  },
});

console.log("Hosted device-sync reconciler Temporal Schedule ensured.", {
  created: result.created,
  intervalMs: config.intervalMs,
  scheduleId: result.scheduleId,
  taskQueue: environment.taskQueue,
  updated: result.updated,
});
