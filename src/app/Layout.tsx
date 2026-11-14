import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

import { IconButton } from "@/ui";

import { StepNav } from "./StepNav";
import { OtherTabNotice } from "./OtherTabNotice";
import { TopBar } from "./TopBar";

/** Scrolls to the top when mounted. Keyed by the route, so each new page starts at the top. */
function ScrollReset() {
  useEffect(() => {
    if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
  }, []);
  return null;
}

/** The app frame: top bar, step sidebar (a drawer on narrow screens) and the content column. */
export function Layout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [location] = useLocation();

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-base font-medium text-text shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <ScrollReset key={location} />
      <TopBar onOpenNav={() => setNavOpen(true)} />
      <div className="flex flex-1">
        <aside className="hidden w-sidebar shrink-0 border-r border-border bg-canvas lg:block">
          <div className="sticky top-topbar max-h-[calc(100dvh-var(--spacing-topbar))] overflow-y-auto px-3 py-5">
            <StepNav />
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <OtherTabNotice />
          {children}
        </main>
      </div>

      <RadixDialog.Root open={navOpen} onOpenChange={setNavOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay lg:hidden" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] animate-slide-in-left flex-col border-r border-border bg-canvas shadow-lg lg:hidden"
          >
            <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border px-4">
              <RadixDialog.Title className="text-md font-semibold text-text">
                Steps
              </RadixDialog.Title>
              <RadixDialog.Close asChild>
                <IconButton label="Close the step list" icon={X} showTooltip={false} />
              </RadixDialog.Close>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-5">
              <StepNav onNavigate={() => setNavOpen(false)} />
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </div>
  );
}
