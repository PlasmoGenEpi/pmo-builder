/**
 * Writing a zip file: each entry deflated with the browser's
 * `CompressionStream`, names in UTF-8. No Zip64, so every entry and the whole
 * archive must stay under 4 GiB.
 */

/** One file to put in a zip. */
export interface ZipEntry {
  /** The path inside the zip, such as `tables/specimens.csv`. */
  readonly name: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

const MAX_SIZE = 0xffff_ffff;

/** Flag bit 11: the name is UTF-8. */
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** The CRC-32 a zip stores for `data`. */
export function crc32(data: Uint8Array): number {
  const lookup = table();
  let crc = 0xffff_ffff;
  for (const byte of data) crc = (lookup[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // A stream of its own rather than Blob.stream(), which jsdom's Blob lacks.
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `date` as MS-DOS time and date, as zip headers store it. */
function dosDateTime(date: Date): { readonly time: number; readonly day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Written {
  readonly name: Uint8Array<ArrayBuffer>;
  readonly crc: number;
  readonly size: number;
  readonly compressed: number;
  readonly offset: number;
}

/** The fields local and central headers share, from "version needed" to the extra field length. */
function common(view: DataView, at: number, entry: Written, when: ReturnType<typeof dosDateTime>) {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 2, UTF8_NAMES, true);
  view.setUint16(at + 4, DEFLATE, true);
  view.setUint16(at + 6, when.time, true);
  view.setUint16(at + 8, when.day, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.compressed, true);
  view.setUint32(at + 18, entry.size, true);
  view.setUint16(at + 22, entry.name.length, true);
  view.setUint16(at + 24, 0, true);
}

/**
 * A zip of `entries`, in order, each dated `modified`. Throws a `RangeError`
 * when the archive would need Zip64.
 */
export async function zipFiles(
  entries: readonly ZipEntry[],
  modified: Date = new Date(),
): Promise<Blob> {
  const encoder = new TextEncoder();
  const when = dosDateTime(modified);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const written: Written[] = [];
  const bodies = await Promise.all(entries.map((entry) => deflate(entry.data)));
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const body = bodies[index] ?? new Uint8Array();
    const record: Written = {
      name: encoder.encode(entry.name),
      crc: crc32(entry.data),
      size: entry.data.length,
      compressed: body.length,
      offset,
    };
    if (record.size > MAX_SIZE || record.compressed > MAX_SIZE) {
      throw new RangeError(`${entry.name} is too large for a zip without Zip64.`);
    }
    const header = new Uint8Array(30 + record.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x0403_4b50, true);
    common(view, 4, record, when);
    header.set(record.name, 30);
    parts.push(header, body);
    written.push(record);
    offset += header.length + body.length;
  }

  const directoryStart = offset;
  for (const record of written) {
    const header = new Uint8Array(46 + record.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x0201_4b50, true);
    view.setUint16(4, VERSION, true);
    common(view, 6, record, when);
    // Comment length, disk number, internal and external attributes: all 0.
    view.setUint32(42, record.offset, true);
    header.set(record.name, 46);
    parts.push(header);
    offset += header.length;
  }
  if (offset > MAX_SIZE || written.length > 0xffff) {
    throw new RangeError("The archive is too large for a zip without Zip64.");
  }

  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x0605_4b50, true);
  view.setUint16(8, written.length, true);
  view.setUint16(10, written.length, true);
  view.setUint32(12, offset - directoryStart, true);
  view.setUint32(16, directoryStart, true);
  parts.push(end);
  return new Blob(parts, { type: "application/zip" });
}
