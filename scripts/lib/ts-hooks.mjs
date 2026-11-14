// Module resolve hooks that let Node run the app's TypeScript modules
// directly (Node strips the types itself): `@/x` points into the source
// folder, and imports without an extension find `x.ts`, `x.tsx` or
// `x/index.ts`. Bare packages that cannot be found from the importing file
// are looked up from this repository, so a copy of `src` elsewhere still
// finds node_modules.
//
// Registered by scripts that load app code, with
// `register("./lib/ts-hooks.mjs", import.meta.url, { data: { src } })`.
import { existsSync, statSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const repository = new URL("../../", import.meta.url);
let srcUrl = new URL("src/", repository);

/** Receives the source folder from `register`. */
export function initialize(data) {
  if (data !== undefined && typeof data.src === "string") {
    srcUrl = pathToFileURL(data.src.endsWith("/") ? data.src : `${data.src}/`);
  }
}

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && statSync(path).isFile()) return url;
  for (const suffix of [".ts", ".tsx", "/index.ts"]) {
    if (existsSync(`${path}${suffix}`)) return pathToFileURL(`${path}${suffix}`).href;
  }
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return { url: withExtension(new URL(specifier.slice(2), srcUrl).href), shortCircuit: true };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:") &&
    !context.parentURL.includes("/node_modules/")
  ) {
    return { url: withExtension(new URL(specifier, context.parentURL).href), shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return next(specifier, { ...context, parentURL: new URL("package.json", repository).href });
  }
}
