/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where usage records go. Unset means nothing is sent. Read by `src/analytics` and `vite/csp.ts`. */
  readonly VITE_ANALYTICS_URL?: string;
  /** The `version` from `package.json`, set by `define` in `vite.config.ts`. */
  readonly PMO_BUILDER_VERSION?: string;
}
