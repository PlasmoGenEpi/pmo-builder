import { readdir, readFile } from "node:fs/promises";

/**
 * Test helpers for reading `public/examples` under Node. Never import this
 * from app code: it uses `node:fs`.
 */
const EXAMPLES = new URL("../../../public/examples/", import.meta.url);

/** Reads one example file as a Blob. */
export async function exampleBlob(name: string): Promise<Blob> {
  return new Blob([new Uint8Array(await readFile(new URL(name, EXAMPLES)))]);
}

/** The names of every example file, sorted. */
export async function exampleNames(): Promise<string[]> {
  const names = await readdir(EXAMPLES);
  return names.filter((name) => !name.startsWith(".")).toSorted();
}
