import type { AppVersion } from "./payload";

const VERSION_SHAPE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function isAppVersion(value: string): value is AppVersion {
  return VERSION_SHAPE.test(value);
}

/** Checks a version string. Anything that is not `major.minor.patch` becomes `unknown`. */
export function toAppVersion(value: unknown): AppVersion {
  return typeof value === "string" && isAppVersion(value) ? value : "unknown";
}
