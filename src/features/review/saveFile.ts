/**
 * Hands a file to the browser to save. The file never leaves the device: it
 * goes through a local object URL.
 */

/** Saves `blob` as `fileName` through a temporary download link. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the URL goes.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
