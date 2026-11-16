/**
 * Reads back a zip that `zipFiles` wrote, for tests: the central directory,
 * then each entry inflated and checked against its CRC.
 */
import { crc32 } from "./zip";

/** One file read from a zip. */
export interface UnzippedFile {
  readonly name: string;
  readonly text: string;
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // A stream of its own rather than Blob.stream(), which jsdom's Blob lacks.
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in `blob`, in the central directory's order. Throws on a bad signature or CRC. */
export async function readZip(blob: Blob): Promise<UnzippedFile[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x0605_4b50) throw new Error("No end of central directory.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: { name: string; crc: number; size: number; body: Uint8Array<ArrayBuffer> }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x0201_4b50) throw new Error("Bad central header.");
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    if (view.getUint32(local, true) !== 0x0403_4b50) throw new Error("Bad local header.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      body: bytes.slice(start, start + compressed),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return Promise.all(
    entries.map(async ({ name, crc, size, body }) => {
      const data = await inflate(body);
      if (data.length !== size || crc32(data) !== crc) throw new Error(`Bad data for ${name}.`);
      return { name, text: decoder.decode(data) };
    }),
  );
}
