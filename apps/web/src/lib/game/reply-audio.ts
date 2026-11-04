import { reject } from "./rules";

const MAX_BYTES = 400_000;
const MAX_DURATION_MS = 30_500;
interface Box { type: string; start: number; end: number; children: Box[] }
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta"]);
const BRANDS = new Set(["M4A ", "mp41", "mp42", "isom", "iso2"]);
const invalid = (): never => reject("INVALID_REQUEST", "Send an AAC M4A voice note of at most 30 seconds and 400 KB.");

/** A bounded container inspection, never decoding, transcribing or sending audio to a model. */
export function inspectReplyAudio(bytes: Uint8Array): { durationMs: number } {
  if (!bytes.length || bytes.length > MAX_BYTES) invalid();
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = 0;
  const walk = (start: number, end: number, depth: number): Box[] => {
    if (depth > 8) invalid();
    const boxes: Box[] = [];
    while (start < end) {
      if (++count > 256 || end - start < 8) invalid();
      const type = data.toString("latin1", start + 4, start + 8);
      let size = data.readUInt32BE(start), header = 8;
      if (size === 1) {
        if (end - start < 16) invalid();
        size = safe64(data, start + 8); header = 16;
      } else if (size === 0) size = end - start;
      if (size < header || size > end - start || ["moof", "mvex", "traf"].includes(type)) invalid();
      const box = { type, start: start + header, end: start + size, children: [] as Box[] };
      if (CONTAINERS.has(type)) box.children = walk(box.start, box.end, depth + 1);
      boxes.push(box); start += size;
    }
    return boxes;
  };
  const root = walk(0, data.length, 0);
  const ftyp = one(root, "ftyp");
  if (ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4 !== 0) invalid();
  const brands = [data.toString("latin1", ftyp.start, ftyp.start + 4)];
  for (let at = ftyp.start + 8; at < ftyp.end; at += 4) brands.push(data.toString("latin1", at, at + 4));
  if (!brands.some(brand => BRANDS.has(brand))) invalid();
  const moov = one(root, "moov");
  duration(data, one(moov.children, "mvhd"));
  const track = one(moov.children, "trak");
  const media = one(track.children, "mdia");
  const handler = one(media.children, "hdlr");
  need(handler, 12);
  if (data.toString("latin1", handler.start + 8, handler.start + 12) !== "soun") invalid();
  const durationMs = duration(data, one(media.children, "mdhd"));
  const minf = one(media.children, "minf");
  const dref = one(one(minf.children, "dinf").children, "dref");
  fullTable(data, dref, 1, 12);
  const reference = one(walk(dref.start + 8, dref.end, 5), "url ");
  if (reference.end - reference.start !== 4 || u32(data, reference, 0) !== 1) invalid();
  const table = one(minf.children, "stbl");
  const stsd = one(table.children, "stsd");
  need(stsd, 8);
  if (u32(data, stsd, 0) !== 0 || u32(data, stsd, 4) !== 1) invalid();
  const descriptions = walk(stsd.start + 8, stsd.end, 6);
  if (descriptions.length !== 1) invalid();
  const audio = one(descriptions, "mp4a");
  need(audio, 28);
  // A local data reference and the ordinary ISO audio sample entry (version 0).
  if (data.readUInt16BE(audio.start + 6) !== 1 || data.readUInt16BE(audio.start + 8) !== 0) invalid();
  const esds = one(walk(audio.start + 28, audio.end, 7), "esds");
  validateAAC(data, esds);
  validateSamples(data, table, root.filter(box => box.type === "mdat"));
  return { durationMs };
}

function one(boxes: Box[], type: string): Box {
  const matches = boxes.filter(box => box.type === type);
  if (matches.length !== 1) invalid();
  return matches[0]!;
}
function need(box: Box, bytes: number): void { if (box.end - box.start < bytes) invalid(); }
function u32(data: Buffer, box: Box, offset: number): number { need(box, offset + 4); return data.readUInt32BE(box.start + offset); }
function safe64(data: Buffer, at: number): number {
  const value = data.readBigUInt64BE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(value);
}
function duration(data: Buffer, box: Box): number {
  need(box, 4);
  const version = data[box.start];
  if (version !== 0 && version !== 1) invalid();
  need(box, version === 1 ? 32 : 20);
  const scale = u32(data, box, version === 1 ? 20 : 12);
  const ticks = version === 1 ? safe64(data, box.start + 24) : u32(data, box, 16);
  const ms = ticks / scale * 1000;
  if (!scale || !Number.isFinite(ms) || ms < 1 || ms > MAX_DURATION_MS) invalid();
  return Math.ceil(ms);
}
function fullTable(data: Buffer, box: Box, count: number, width: number): void {
  if (u32(data, box, 0) !== 0 || u32(data, box, 4) !== count || box.end - box.start !== 8 + count * width) invalid();
}

/** mp4a can describe non-AAC MPEG audio too; require AAC's decoder configuration. */
function validateAAC(data: Buffer, box: Box): void {
  if (u32(data, box, 0) !== 0) invalid();
  const descriptor = (at: number, end: number, tag: number) => {
    if (at >= end || data[at++] !== tag) invalid();
    let length = 0, done = false;
    for (let n = 0; n < 4 && at < end; n++) {
      const byte = data[at++]!; length = length * 128 + (byte & 127);
      if (!(byte & 128)) { done = true; break; }
    }
    if (!done || length > end - at) invalid();
    return { start: at, end: at + length };
  };
  const es = descriptor(box.start + 4, box.end, 3);
  if (es.end - es.start < 3) invalid();
  let at = es.start + 3;
  const flags = data[es.start + 2]!;
  if (flags & 128) at += 2;
  if (flags & 64) { if (at >= es.end) invalid(); at += 1 + data[at]!; }
  if (flags & 32) at += 2;
  const decoder = descriptor(at, es.end, 4);
  if (decoder.end - decoder.start < 13 || data[decoder.start] !== 0x40 || (data[decoder.start + 1]! >> 2) !== 5) invalid();
  const config = descriptor(decoder.start + 13, decoder.end, 5);
  if (config.end - config.start < 2 || ![2, 5, 29].includes(data[config.start]! >> 3)) invalid();
}

function sampleTables(data: Buffer, table: Box) {
  const sizeBox = one(table.children, "stsz");
  const fixedSize = u32(data, sizeBox, 4), sampleCount = u32(data, sizeBox, 8);
  if (u32(data, sizeBox, 0) !== 0 || !sampleCount || sampleCount > MAX_BYTES
    || sizeBox.end - sizeBox.start !== 12 + (fixedSize ? 0 : sampleCount * 4)) invalid();
  const offsetBoxes = table.children.filter(box => box.type === "stco" || box.type === "co64");
  if (offsetBoxes.length !== 1) invalid();
  const offsets = offsetBoxes[0]!, width = offsets.type === "co64" ? 8 : 4;
  const chunks = u32(data, offsets, 4);
  if (!chunks || chunks > sampleCount) invalid();
  fullTable(data, offsets, chunks, width);
  const mapping = one(table.children, "stsc"), rows = u32(data, mapping, 4);
  if (!rows || rows > chunks) invalid();
  fullTable(data, mapping, rows, 12);
  const runs = Array.from({ length: rows }, (_, n) => ({ first: u32(data, mapping, 8 + n * 12), count: u32(data, mapping, 12 + n * 12), description: u32(data, mapping, 16 + n * 12) }));
  if (runs[0]!.first !== 1 || runs.some((run, n) => !run.count || run.count > sampleCount || run.description !== 1 || run.first > chunks || (n > 0 && run.first <= runs[n - 1]!.first))) invalid();
  return { sizeBox, fixedSize, sampleCount, offsets, width, chunks, runs };
}

function validateSamples(data: Buffer, table: Box, mdats: Box[]): void {
  const { sizeBox, fixedSize, sampleCount, offsets, width, chunks, runs } = sampleTables(data, table);
  let sample = 0, run = 0, previousEnd = 0;
  for (let chunk = 1; chunk <= chunks; chunk++) {
    if (run + 1 < runs.length && chunk === runs[run + 1]!.first) run++;
    const at = offsets.start + 8 + (chunk - 1) * width;
    const offset = width === 8 ? safe64(data, at) : data.readUInt32BE(at);
    let length = 0;
    if (sample + runs[run]!.count > sampleCount) invalid();
    for (let i = 0; i < runs[run]!.count; i++, sample++) {
      const size = fixedSize || u32(data, sizeBox, 12 + sample * 4);
      if (!size) invalid();
      length += size;
    }
    if (offset < previousEnd || !mdats.some(box => offset >= box.start && offset + length <= box.end)) invalid();
    previousEnd = offset + length;
  }
  if (sample !== sampleCount) invalid();
}
