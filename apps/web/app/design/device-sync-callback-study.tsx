import { HostedDeviceSyncCallbackConfirmation } from "@/src/components/device-sync/hosted-device-sync-callback-confirmation";

export function DeviceSyncCallbackStudy() {
  return (
    <div
      className="grid gap-8 xl:grid-cols-2"
      data-design-section="device-sync-callback-study"
      inert
    >
      <div className="overflow-hidden rounded-2xl border border-border">
        <HostedDeviceSyncCallbackConfirmation
          action="/"
          state="confirmation"
        />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border">
        <HostedDeviceSyncCallbackConfirmation state="failure" />
      </div>
    </div>
  );
}
