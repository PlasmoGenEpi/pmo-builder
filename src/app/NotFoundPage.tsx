import { t } from "@lingui/core/macro";
import { MapPinOff } from "lucide-react";

import { ButtonLink, EmptyState } from "@/ui";

import { PageContainer } from "./PageContainer";

/** Shown for an address the app does not know. */
export function NotFoundPage() {
  return (
    <PageContainer>
      <h1 className="sr-only">{t`Page not found`}</h1>
      <EmptyState
        icon={MapPinOff}
        title={t`This page does not exist`}
        description={t`The link may be out of date. Your work is still saved.`}
        action={
          <ButtonLink href="#/" variant="primary">
            {t`Go to the home page`}
          </ButtonLink>
        }
      />
    </PageContainer>
  );
}
