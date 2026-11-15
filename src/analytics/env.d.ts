/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where usage records go. Unset means nothing is sent. Read by `src/analytics` and `vite/csp.ts`. */
  readonly VITE_ANALYTICS_URL?: string;
  /** The Zenodo community that PMO files are published to. Unset hides the publish panel. */
  readonly VITE_ZENODO_COMMUNITY?: string;
  /**
   * The identifier of the application registered with Zenodo. With it the
   * panel can sign the user in and prepare a draft. Read by the panel and `vite.config.ts`.
   */
  readonly VITE_ZENODO_CLIENT_ID?: string;
  /** What to call the community on screen. Default: its identifier. */
  readonly VITE_ZENODO_COMMUNITY_NAME?: string;
  /** The `version` from `package.json`, set by `define` in `vite.config.ts`. */
  readonly PMO_BUILDER_VERSION?: string;
}
