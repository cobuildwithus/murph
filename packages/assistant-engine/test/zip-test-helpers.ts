import { crc32, deflateRawSync } from 'node:zlib'

export function createTestZip(
  entries: ReadonlyArray<readonly [string, string | Uint8Array]>,
): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const contents = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
    const compressed = deflateRawSync(contents)
    const entryCrc32 = crc32(contents) >>> 0
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt32LE(entryCrc32, 14)
    localHeader.writeUInt32LE(compressed.byteLength, 18)
    localHeader.writeUInt32LE(contents.byteLength, 22)
    localHeader.writeUInt16LE(nameBytes.byteLength, 26)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(entryCrc32, 16)
    centralHeader.writeUInt32LE(compressed.byteLength, 20)
    centralHeader.writeUInt32LE(contents.byteLength, 24)
    centralHeader.writeUInt16LE(nameBytes.byteLength, 28)
    centralHeader.writeUInt32LE(localOffset, 42)

    const localPart = Buffer.concat([localHeader, nameBytes, compressed])
    localParts.push(localPart)
    centralParts.push(Buffer.concat([centralHeader, nameBytes]))
    localOffset += localPart.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12)
  endOfCentralDirectory.writeUInt32LE(localOffset, 16)

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ])
}
