import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "./cn";

/** What to show in a toast. */
export interface ToastOptions {
  title: string;
  description?: string;
  tone?: "info" | "success" | "warning" | "error";
  /** One follow-up action, such as "Undo". */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it hides. Errors stay until dismissed unless this is set. */
  duration?: number;
}

/** What {@link useToast} returns. */
export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastEntry extends ToastOptions {
  id: string;
  open: boolean;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = {
  info: { Icon: Info, className: "text-info" },
  success: { Icon: CircleCheck, className: "text-success" },
  warning: { Icon: TriangleExclamationPoint, className: "text-warning" },
  error: { Icon: CircleExclamationPoint, className: "text-danger" },
} as const;

let counter = 0;

/**
 * Shows short messages about something that just happened, such as "PMO file
 * downloaded". Put it once near the root. Use `useToast` to show one.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, open: false } : entry)),
    );
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    counter += 1;
    const id = `toast-${counter}`;
    setToasts((current) => [...current.slice(-3), { ...options, id, open: true }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider swipeDirection="right" label="Notification">
        {children}
        {toasts.map((entry) => {
          const tone = entry.tone ?? "info";
          const { Icon, className } = icons[tone];
          return (
            <RadixToast.Root
              key={entry.id}
              open={entry.open}
              type={tone === "error" ? "foreground" : "background"}
              duration={entry.duration ?? (tone === "error" ? Infinity : 5000)}
              onOpenChange={(open) => {
                if (!open) dismiss(entry.id);
              }}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-lg",
                "data-[state=open]:animate-slide-in-up data-[state=closed]:animate-fade-in data-[state=closed]:opacity-0",
                "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x)",
              )}
            >
              <Icon aria-hidden="true" className={cn("mt-0.5 size-4.5 shrink-0", className)} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <RadixToast.Title className="text-base font-medium text-text">
                  {entry.title}
                </RadixToast.Title>
                {entry.description ? (
                  <RadixToast.Description className="text-sm text-text-muted">
                    {entry.description}
                  </RadixToast.Description>
                ) : null}
                {entry.action ? (
                  <RadixToast.Action altText={entry.action.label} asChild>
                    <button
                      type="button"
                      onClick={entry.action.onClick}
                      className="mt-1.5 self-start rounded-sm text-sm font-medium text-accent-text hover:underline"
                    >
                      {entry.action.label}
                    </button>
                  </RadixToast.Action>
                ) : null}
              </div>
              <RadixToast.Close
                aria-label="Dismiss"
                className="-m-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text"
              >
                <X aria-hidden="true" className="size-4" />
              </RadixToast.Close>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-[60] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

/** Returns the functions that show and hide toasts. Must be used inside `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
