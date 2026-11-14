import { ImportError } from "./errors";

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** True for gzip data (`1f 8b`). */
export function isGzip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x1f, 0x8b]);
}

/** True for a zip archive (`PK\x03\x04`), which is what an `.xlsx` workbook is. */
export function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

/** True for an old binary Office file (`.xls`), which starts with the OLE signature. */
export function isOle(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

/**
 * Unpacks gzip data with the platform `DecompressionStream`, present in
 * browsers, web workers and Node. Stops and returns `null` as soon as the
 * unpacked data passes `maxBytes`, so a small file that unpacks to something
 * huge never fills memory.
 *
 * @throws {ImportError} `unreadable-file` when the data is damaged.
 */
export async function gunzip(
  bytes: Uint8Array,
  fileName: string,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array | null> {
  try {
    const reader = new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      // Chunks arrive one after another; each read waits for the next.
      // oxlint-disable-next-line no-await-in-loop -- a stream is read in order
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop -- stops the stream once, then returns
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch (error) {
    throw new ImportError(
      "unreadable-file",
      `${fileName} looks compressed but could not be unpacked. Check that the file is complete, or upload it uncompressed.`,
      { cause: error },
    );
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

/**
 * Decodes text bytes. A UTF-16 byte order mark selects UTF-16. Otherwise the
 * bytes are read as UTF-8, and as Windows-1252 if they are not valid UTF-8
 * (older Excel exports on Windows). A byte order mark is never part of the text.
 */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF16LE_BOM)) return new TextDecoder("utf-16le").decode(bytes);
  if (startsWith(bytes, UTF16BE_BOM)) return new TextDecoder("utf-16be").decode(bytes);
  const body = startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    text = new TextDecoder("windows-1252").decode(body);
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}
