export interface CompanionClientInfo {
  platform: "ios" | "android";
  version: string;
  build: string;
  osVersion: string | null;
  deviceModel: string | null;
}

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}(-[A-Za-z0-9.]{1,24})?$/;
const BUILD = /^\d{1,10}$/;
const OS_VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;
const DEVICE_MODEL = /^[A-Za-z0-9 ,._()+-]{1,64}$/;

export function readCompanionClientInfo(headers: Headers): CompanionClientInfo | null {
  const platform = headers.get("X-Murph-Client-Platform")?.trim();
  const version = headers.get("X-Murph-Client-Version")?.trim() ?? "";
  const build = headers.get("X-Murph-Client-Build")?.trim() ?? "";
  if ((platform !== "ios" && platform !== "android") || !VERSION.test(version) || !BUILD.test(build)) {
    return null;
  }
  const osVersion = headers.get("X-Murph-Client-OS-Version")?.trim() ?? "";
  const deviceModel = headers.get("X-Murph-Client-Device-Model")?.trim() ?? "";
  return {
    platform, version, build,
    osVersion: OS_VERSION.test(osVersion) ? osVersion : null,
    deviceModel: DEVICE_MODEL.test(deviceModel) ? deviceModel : null,
  };
}
