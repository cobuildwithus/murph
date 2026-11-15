export { billing, posterWords } from "./closing-pages.js";
export { starringLine } from "./pages.js";
export { RECAP_VIDEO_MAX_BYTES, encodeRecapVideo, videoKbpsCeiling, type RecapVideoEncodeOptions, type RecapVideoEncodeResult } from "./encode.js";
export { createRecapVideoRenderer, type RecapVideoFrameState, type RecapVideoRenderer } from "./renderer.js";
export { RECAP_VIDEO_FPS, buildRecapVideoTimeline, type RecapVideoEntry, type RecapVideoEntryKind, type RecapVideoTimeline } from "./timeline.js";
export {
  RecapVideoRefusal,
  type RecapVideoBackground, type RecapVideoBlock, type RecapVideoInput, type RecapVideoOutcome, type RecapVideoPage, type RecapVideoPlayer,
  type RecapVideoRefusalCode, type RecapVideoScore, type RecapVideoSongWord, type RecapVideoStake,
} from "./types.js";
// Types only: the child entry (`child.js`, beside this file) runs a render when started as a process and must never be imported.
export type { RecapVideoChildRequest, RecapVideoChildResult } from "./child.js";
