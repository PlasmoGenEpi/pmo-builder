import { MapPinOff } from "lucide-react";

import { ButtonLink, EmptyState } from "@/ui";

import { PageContainer } from "./PageContainer";

/** Shown for an address the app does not know. */
export function NotFoundPage() {
  return (
    <PageContainer>
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={MapPinOff}
        title="This page does not exist"
        description="The link may be out of date. Your work is still saved."
        action={
          <ButtonLink href="#/" variant="primary">
            Go to the home page
          </ButtonLink>
        }
      />
    </PageContainer>
  );
}
