import { t } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { Suspense, useEffect, type ReactNode } from "react";
import { Route, Router, Switch, useLocation, type BaseLocationHook } from "wouter";
// Aliased: the router takes the hook itself as a value.
import { useHashLocation as hashLocation } from "wouter/use-hash-location";

import { recordPageOpened, recordStepOpened } from "@/analytics";
import { i18n } from "@/i18n";
import { AppStoreProvider, type AppStore } from "@/state";
import { Skeleton, ToastProvider } from "@/ui";

import { ErrorBoundary } from "./ErrorBoundary";
import { HomePage } from "./HomePage";
import { Layout } from "./Layout";
import { NotFoundPage } from "./NotFoundPage";
import { PageContainer } from "./PageContainer";
import { RestoreNotice } from "./RestoreNotice";
import { STEPS, getAdjacentSteps, page, type StepDefinition } from "./steps";

const Published = page(() =>
  import("@/features/published/PublishedPage").then((module) => module.PublishedPage),
);
const PublishedDataset = page(() =>
  import("@/features/published/DatasetPage").then((module) => module.DatasetRoute),
);

const PublishFile = page(() =>
  import("@/features/publish-file/PublishFilePage").then((module) => module.PublishFilePage),
);

const TranslateReview = page(() =>
  import("@/features/translate/TranslateReviewPage").then((module) => module.TranslateReviewRoute),
);

const Styleguide = page(() =>
  import("./styleguide/StyleguidePage").then((module) => module.StyleguidePage),
);

/** Runs `task` when the browser is idle, or after a short wait where it cannot say. Returns a cancel function. */
function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 200);
  return () => window.clearTimeout(handle);
}

/** The step a user is likely to open next from `location`: the first step from home, else the next one. */
function nextStepFrom(location: string): StepDefinition | null {
  if (location === "/") return STEPS[0] ?? null;
  const current = STEPS.find((step) => step.path === location);
  return current === undefined ? null : getAdjacentSteps(current.id).next;
}

/** Loads the next step's code when the browser is idle, so moving to it shows no loading state. */
function usePreloadNextStep(location: string): void {
  useEffect(() => {
    const next = nextStepFrom(location);
    if (next === null) return undefined;
    return whenIdle(() => {
      void next.preload();
    });
  }, [location]);
}

/** What shows while a step's code loads. */
function PageSkeleton() {
  return (
    <PageContainer>
      <output className="flex flex-col gap-4" aria-busy="true" aria-label={t`Loading`}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-full max-w-md" />
        <Skeleton className="mt-6 h-48 w-full" />
      </output>
    </PageContainer>
  );
}

/** Counts each step the user opens. Only the step's fixed name is recorded. */
function useRecordStepOpened(location: string): void {
  useEffect(() => {
    if (location === "/") {
      recordStepOpened("home");
      return;
    }
    const step = STEPS.find((candidate) => candidate.path === location);
    if (step !== undefined) recordStepOpened(step.id);
    // Other pages are counted by kind. A dataset page never says which dataset.
    if (location === "/published") recordPageOpened("published");
    else if (location.startsWith("/published/")) recordPageOpened("dataset");
    else if (location === "/publish") recordPageOpened("publish-file");
  }, [location]);
}

function Routes() {
  const [location] = useLocation();
  useRecordStepOpened(location);
  usePreloadNextStep(location);
  return (
    <ErrorBoundary key={location}>
      <Suspense fallback={<PageSkeleton />}>
        <Switch>
          <Route path="/">
            <HomePage />
          </Route>
          {STEPS.map((step) => (
            <Route key={step.id} path={step.path} component={step.component} />
          ))}
          <Route path="/published" component={Published.component} />
          <Route path="/published/:id" component={PublishedDataset.component} />
          <Route path="/publish" component={PublishFile.component} />
          <Route path="/translate/:locale/:key" component={TranslateReview.component} />
          <Route path="/styleguide" component={Styleguide.component} />
          <Route>
            <NotFoundPage />
          </Route>
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

/** Props for {@link App}. */
export interface AppProps {
  /** Location hook for the router. Defaults to hash routing (`#/panel`); tests pass a memory location. */
  locationHook?: BaseLocationHook;
  /** The app store. Defaults to the one with the engine in a web worker and the draft in IndexedDB; tests pass their own. */
  store?: AppStore;
  /** Extra content inside the providers, for tests. */
  children?: ReactNode;
}

/** The application: store, router, toasts, layout and pages. */
// The router calls the location hook on every render; passing it is how wouter is configured.
// oxlint-disable-next-line react/hooks
export function App({ locationHook = hashLocation, store, children }: AppProps) {
  return (
    <I18nProvider i18n={i18n}>
      <AppStoreProvider store={store}>
        <ToastProvider>
          {/* oxlint-disable-next-line react/hooks */}
          <Router hook={locationHook}>
            <Layout>
              <Routes />
            </Layout>
            <RestoreNotice />
            {children}
          </Router>
        </ToastProvider>
      </AppStoreProvider>
    </I18nProvider>
  );
}
