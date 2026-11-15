import {
  ArrowRight,
  Dna,
  Download,
  FlaskConical,
  Microscope,
  ShieldCheck,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Link as RouterLink, useLocation } from "wouter";

import { zenodoConfig } from "@/features/review/zenodo";

import { Badge, Button, Callout, Card, ConfirmDialog, Link, ProgressBar } from "@/ui";

import { useHasSavedDraft, useLoadExampleData } from "./draftHooks";
import { Logo } from "./Logo";
import { PageContainer } from "./PageContainer";
import { StartOverButton } from "./StartOver";
import { STEPS } from "./steps";

interface Need {
  icon: LucideIcon;
  title: string;
  description: string;
  required: boolean;
}

const NEEDS: readonly Need[] = [
  {
    icon: Dna,
    title: t`Allele table`,
    description: t`The microhaplotypes called in each sample, with their read counts.`,
    required: true,
  },
  {
    icon: Table2,
    title: t`Panel table`,
    description: t`Each target in your panel with its forward and reverse primer.`,
    required: true,
  },
  {
    icon: Microscope,
    title: t`Sample metadata`,
    description: t`Where and when specimens were collected, and how libraries link to them.`,
    required: false,
  },
  {
    icon: FlaskConical,
    title: t`Study and methods`,
    description: t`Project, sequencing and bioinformatics details, typed in or from a file.`,
    required: false,
  },
  {
    icon: Workflow,
    title: t`Read counts by stage`,
    description: t`How many reads each sample kept at each step of your pipeline.`,
    required: false,
  },
];

/** Loading the example from the home page. */
type ExampleLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string };

const TEMPLATE_URL = `${import.meta.env.BASE_URL}examples/PMO_building_template.xlsx`;

/** The landing page: what the app does, the privacy promise and how to start. */
export function HomePage({
  showPublished = zenodoConfig() !== null,
}: {
  /** Whether to link to the published PMOs. Default: when a Zenodo community is set. */
  readonly showPublished?: boolean;
} = {}) {
  const hasDraft = useHasSavedDraft();
  const loadExampleData = useLoadExampleData();
  const [, navigate] = useLocation();
  const [example, setExample] = useState<ExampleLoad>({ kind: "idle" });
  const [confirmingExample, setConfirmingExample] = useState(false);
  const loadingExample = example.kind === "loading";
  const exampleMessage = example.kind === "failed" ? example.message : "";
  const firstStep = STEPS[0];
  const firstPath = firstStep?.path ?? "/";

  async function tryExample() {
    setExample({ kind: "loading" });
    try {
      await loadExampleData();
      setExample({ kind: "idle" });
      navigate(firstPath);
    } catch (error) {
      console.error(error);
      setExample({
        kind: "failed",
        message: error instanceof Error ? error.message : t`The example could not be loaded.`,
      });
    }
  }

  return (
    <PageContainer>
      <section aria-labelledby="home-title" className="flex flex-col gap-6 lg:pt-6">
        <Logo className="size-12" />
        <div className="flex flex-col gap-4">
          <h1
            id="home-title"
            className="text-3xl font-semibold tracking-tight text-balance text-text"
          >
            <Trans>Turn your lab&apos;s tables into a PMO file</Trans>
          </h1>
          <p className="max-w-2xl text-md text-pretty text-text-muted">
            {t`PMO Builder reads your allele table, panel table and sample metadata, matches their columns to the fields of a Portable Microhaplotype Object, and builds a PMO file you can download. You can fill in the steps in any order, and your work is saved as you go.`}
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-subtle px-4 py-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-base text-text">
            <Trans>
              <span className="font-semibold">Your data stays on this device.</span> Files are read
              inside this browser and are never uploaded.
            </Trans>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => navigate(firstPath)}
            className="max-sm:w-full"
          >
            {hasDraft ? t`Continue where you left off` : t`Start`}
            <ArrowRight aria-hidden="true" className="size-4.5" />
          </Button>
          <Button
            size="lg"
            loading={loadingExample}
            onClick={() => {
              if (hasDraft) setConfirmingExample(true);
              else void tryExample();
            }}
            className="max-sm:w-full"
          >
            {t`Try with example data`}
          </Button>
          {hasDraft ? (
            <StartOverButton variant="ghost" size="lg" className="max-sm:w-full" />
          ) : null}
        </div>
        {showPublished ? (
          <p className="text-base text-text-muted">
            <Trans>
              Looking for data?{" "}
              <RouterLink
                href="/published"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Browse the published PMOs
              </RouterLink>
              . Have a PMO file already?{" "}
              <RouterLink
                href="/publish"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Publish it
              </RouterLink>
              , or{" "}
              <RouterLink
                href="/pmo-tools"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                subset it or download its tables
              </RouterLink>
              .
            </Trans>
          </p>
        ) : (
          <p className="text-base text-text-muted">
            <Trans>
              Have a PMO file already?{" "}
              <RouterLink
                href="/pmo-tools"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Subset it or download its tables
              </RouterLink>
              .
            </Trans>
          </p>
        )}
        {example.kind === "loading" ? (
          <ProgressBar label={t`Loading the example tables`} value={null} className="max-w-md" />
        ) : null}
        {example.kind === "failed" ? (
          <Callout
            tone="error"
            live
            title={t`The example data could not be loaded`}
            action={
              <Button
                size="sm"
                onClick={() => {
                  void tryExample();
                }}
              >
                {t`Try again`}
              </Button>
            }
          >
            {t`${exampleMessage} Check your connection to this site, then try again.`}
          </Callout>
        ) : null}
        <ConfirmDialog
          open={confirmingExample}
          onOpenChange={setConfirmingExample}
          title={t`Replace your draft with the example?`}
          description={t`The example tables take the place of the tables and choices in your draft. This cannot be undone.`}
          confirmLabel={t`Use the example`}
          tone="danger"
          onConfirm={() => {
            void tryExample();
          }}
        />
      </section>

      <section aria-labelledby="needs-title" className="mt-14 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-1">
            <h2 id="needs-title" className="text-lg font-semibold tracking-tight text-text">
              {t`What you will need`}
            </h2>
            <p className="text-base text-text-muted">
              {t`Tables can be CSV, TSV, plain text or Excel files.`}
            </p>
          </div>
          <Link
            href={TEMPLATE_URL}
            download="PMO_building_template.xlsx"
            variant="standalone"
            className="inline-flex items-center gap-1.5 text-base"
          >
            <Download aria-hidden="true" className="size-4" />
            {t`Download the Excel template`}
          </Link>
        </div>
        <Card padding="none" as="section" aria-label={t`Tables and details`}>
          <ul className="divide-y divide-border">
            {NEEDS.map((need) => {
              const Icon = need.icon;
              return (
                <li key={need.title} className="flex items-start gap-4 px-5 py-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-muted">
                    <Icon aria-hidden="true" className="size-4.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-medium text-text">{need.title}</h3>
                      {need.required ? (
                        <Badge tone="accent">
                          {t({
                            message: "Required",
                            context: "table",
                            comment: "Marks a table a PMO file needs",
                          })}
                        </Badge>
                      ) : (
                        <Badge>
                          {t({
                            message: "Optional",
                            context: "table",
                            comment: "Marks a table a PMO file can do without",
                          })}
                        </Badge>
                      )}
                    </div>
                    <p className="text-base text-text-muted">{need.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </PageContainer>
  );
}
