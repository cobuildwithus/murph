import {
  isDeviceConnectSourceAvailableForConnection,
  normalizeDeviceConnectSourceId,
} from "@murphai/device-syncd/connect-config";

import { connectSourcePath, connectSourcePngLogoPath, readConnectSourceUi } from "./connect-sources";

/** What `withmurph.ai/connect/<source>` is a link to. */
export type ConnectLinkSource =
  /** Connects in the Murph app: Apple Health, or a wearable that comes in through it. */
  | { id: string; kind: "app"; logoPath: string; name: string }
  /** Signs in on its own website, which the website's connect page can do with no app. */
  | { id: string; kind: "web" };

/**
 * The source a connect link names, or null for one that is unknown or not
 * offered right now. "Offered" is the same check the website's connect page,
 * connect start and the app's list use, so pausing a source closes its link
 * too.
 */
export function resolveConnectLinkSource(raw: string): ConnectLinkSource | null {
  const id = normalizeDeviceConnectSourceId(raw);
  const ui = id ? readConnectSourceUi(id) : null;
  if (!id || !ui || !isDeviceConnectSourceAvailableForConnection(id)) return null;
  if (connectSourcePath(id) === "web") return { id, kind: "web" };
  const logoPath = connectSourcePngLogoPath(id);
  return logoPath ? { id, kind: "app", logoPath, name: ui.name } : null;
}
