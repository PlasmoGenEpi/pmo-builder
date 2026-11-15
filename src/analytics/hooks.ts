import { useCallback, useSyncExternalStore } from "react";

import type { Analytics, TransparencySnapshot } from "./analytics";
import type { AnalyticsStatus } from "./status";

/** The user's own switch, for a settings control. */
export interface AnalyticsPreference {
  /** Whether the user's switch is on. The browser can still turn sending off. */
  readonly enabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
}

/** The React hooks for one instrumentation instance. */
export interface AnalyticsHooks {
  useAnalyticsStatus(): AnalyticsStatus;
  useAnalyticsPreference(): AnalyticsPreference;
  useTransparencyLog(): TransparencySnapshot;
  /** Whether the app should ask the user about usage counts. */
  useUsageChoiceNeeded(): boolean;
}

/** Builds the hooks for `analytics`. `index.ts` exports the ones for the app. */
export function createAnalyticsHooks(analytics: Analytics): AnalyticsHooks {
  return {
    useAnalyticsStatus() {
      return useSyncExternalStore(analytics.subscribe, analytics.getStatus);
    },
    useAnalyticsPreference() {
      const enabled = useSyncExternalStore(analytics.subscribe, analytics.isEnabledByUser);
      const setEnabled = useCallback((value: boolean) => analytics.setEnabledByUser(value), []);
      return { enabled, setEnabled };
    },
    useTransparencyLog() {
      return useSyncExternalStore(analytics.subscribe, analytics.getTransparencySnapshot);
    },
    useUsageChoiceNeeded() {
      return useSyncExternalStore(analytics.subscribe, analytics.needsChoice);
    },
  };
}
