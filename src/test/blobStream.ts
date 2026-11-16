/**
 * Gives the test DOM's `Blob` a `stream()`, which jsdom lacks and gzip
 * needs, so page tests can make and read `.json.gz` files as browsers do.
 * Not part of the app bundle.
 */
export function installBlobStream(): void {
  if (typeof Blob.prototype.stream === "function") return;
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    value(this: Blob): ReadableStream<Uint8Array> {
      const read = (): Promise<ArrayBuffer> => this.arrayBuffer();
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(await read()));
          controller.close();
        },
      });
    },
  });
}
