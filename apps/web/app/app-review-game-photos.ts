import { readFile } from "node:fs/promises";

import type { HostedOpsAppReviewGamePhotoReader } from "@/src/lib/hosted-ops/app-review-game";
import { resolveRuntimeAssetPath } from "./runtime-asset-files";

/** Public photos traced into the Ops and Home functions. */
export const readAppReviewGamePhoto: HostedOpsAppReviewGamePhotoReader = async (publicPath) =>
  new Uint8Array(await readFile(resolveRuntimeAssetPath(`public${publicPath}`)));
