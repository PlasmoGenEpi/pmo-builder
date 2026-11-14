import { RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button, ButtonLink, Callout } from "@/ui";

import { PageContainer } from "./PageContainer";

interface ErrorBoundaryProps {
  children: ReactNode;
}

type ErrorBoundaryState = { failed: false } | { failed: true; message: string };

/**
 * Catches a crash in a page and shows a calm way out instead of a blank
 * screen. Give it a `key` that changes with the route so a new page gets a
 * fresh start. (React only supports error boundaries as class components.)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("A page crashed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <PageContainer>
        <Callout
          tone="error"
          title="Something went wrong on this page"
          action={
            <>
              <Button variant="primary" icon={RotateCw} onClick={() => window.location.reload()}>
                Reload the page
              </Button>
              <ButtonLink href="#/">Go to the home page</ButtonLink>
            </>
          }
        >
          <p>
            Your work is saved in this browser, so reloading will not lose it. If this keeps
            happening, note what you did just before and tell the PMO Builder team.
          </p>
          <details className="mt-3 text-sm text-text-muted">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1 font-mono break-words">{this.state.message}</p>
          </details>
        </Callout>
      </PageContainer>
    );
  }
}
