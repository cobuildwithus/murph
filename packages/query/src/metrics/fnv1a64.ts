/** 64-bit FNV-1a over UTF-16 code units, as 16 hex digits. Every metric point
 * id is one of these, so the hash runs as two 32-bit halves instead of BigInt.
 * The prime is 2^40 + 0x1b3: the low half's product stays under 2^41 (exact in
 * a double) and the 2^40 term only shifts the low half into the high half. */
export function fnv1a64Hex(value: string): string {
  let high = 0xcbf29ce4;
  let low = 0x84222325;

  for (let index = 0; index < value.length; index += 1) {
    low = (low ^ value.charCodeAt(index)) >>> 0;
    const lowProduct = low * 0x1b3;
    high = (Math.imul(high, 0x1b3) + Math.floor(lowProduct / 0x100000000) + (low << 8)) >>> 0;
    low = lowProduct >>> 0;
  }

  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
