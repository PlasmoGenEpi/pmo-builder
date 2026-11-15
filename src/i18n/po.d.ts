/** A catalog file, compiled when it is imported by `@lingui/vite-plugin`. */
declare module "*.po" {
  import type { Messages } from "@lingui/core";

  export const messages: Messages;
}
