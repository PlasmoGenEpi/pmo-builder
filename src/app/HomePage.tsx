import {
  ArrowRight,
  Dna,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Hammer,
  LibraryBig,
  Microscope,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { plural, t } from "@lingui/core/macro";
import { useState, type ReactNode } from "react";
import { Link as RouterLink, useLocation } from "wouter";

import { zenodoConfig } from "@/features/review/zenodo";
import { useBuildState } from "@/state";

import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Link,
  ProgressBar,
  buttonClassName,
} from "@/ui";

import { useHasSavedDraft, useLoadExampleData } from "./draftHooks";
import { Logo } from "./Logo";
import { PageContainer } from "./PageContainer";
import { StartOverButton } from "./StartOver";
import { BUILD_PATH, STEPS } from "./steps";
import { useStepStatuses } from "./stepStatus";

/** One of the three things the app does, as a card on the home page. */
function JobCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  /** The card's main action. */
  readonly children: ReactNode;
  /** Smaller actions under it. The row is kept when empty, so main actions line up across cards. */
  readonly footer?: ReactNode;
}) {
  return (
    <Card as="article" className="flex flex-col gap-4">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent-subtle text-accent-text">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-1 flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-text">{title}</h2>
        <p className="text-base text-pretty text-text-muted">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
      <div className="-mx-3 -my-1 flex min-h-8 flex-wrap items-center gap-1">{footer}</div>
    </Card>
  );
}

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

/** The landing page: the three things the app does, and what building needs. The privacy promise is in the top bar. */
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
  const firstPath = firstStep?.path ?? BUILD_PATH;
  const statuses = useStepStatuses();
  const required = STEPS.filter((step) => step.required);
  const readyCount = required.filter((step) => statuses[step.id] === "ready").length;
  const requiredCount = required.length;
  const builtIsValid = useBuildState().view?.overall.pmo === "valid";

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
    <PageContainer width="full">
      <section aria-labelledby="home-title" className="flex flex-col gap-6 lg:pt-6">
        <div className="flex items-center gap-4">
          <Logo className="size-12" />
          <div className="flex flex-col gap-1">
            <h1 id="home-title" className="text-3xl font-semibold tracking-tight text-text">
              PMO Builder
            </h1>
            <p className="text-md text-pretty text-text-muted">
              {t`Make, use and find Portable Microhaplotype Object (PMO) files.`}
            </p>
          </div>
        </div>

        <div className={showPublished ? "grid gap-4 lg:grid-cols-3" : "grid gap-4 lg:grid-cols-2"}>
          <JobCard
            icon={Hammer}
            title={t`Build a PMO`}
            description={t`From your lab's allele table, panel table and sample metadata. Fill in the steps in any order; your work is saved as you go.`}
            footer={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={loadingExample}
                  onClick={() => {
                    if (hasDraft) setConfirmingExample(true);
                    else void tryExample();
                  }}
                >
                  {t`Try with example data`}
                </Button>
                {hasDraft ? <StartOverButton variant="ghost" size="sm" /> : null}
              </>
            }
          >
            <Button variant="primary" onClick={() => navigate(firstPath)}>
              {hasDraft ? t`Continue your draft` : t`Start`}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
            {hasDraft ? (
              <p className="text-sm text-text-muted">
                {plural(requiredCount, {
                  one: `${readyCount} of # required step ready`,
                  other: `${readyCount} of # required steps ready`,
                })}
              </p>
            ) : null}
          </JobCard>
          <JobCard
            icon={FileSpreadsheet}
            title={t`Work with a PMO file`}
            description={t`Open a PMO file to see a summary of its samples and targets, compare groups of specimens, download its tables, make a subset, or publish it.`}
            footer={
              builtIsValid ? (
                // The address My PMO file opens the built PMO at; see PmoFilePage.
                <RouterLink
                  href="/pmo/open-built"
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  {t`Open the PMO you are building`}
                </RouterLink>
              ) : null
            }
          >
            <RouterLink href="/pmo" className={buttonClassName({ variant: "secondary" })}>
              {t`Open a PMO file`}
              <ArrowRight aria-hidden="true" className="size-4" />
            </RouterLink>
          </JobCard>
          {showPublished ? (
            <JobCard
              icon={LibraryBig}
              title={t`Find published PMOs`}
              description={t`Datasets shared in the PlasmoGenEpi community on Zenodo, with their countries, years and panels.`}
            >
              <RouterLink href="/published" className={buttonClassName({ variant: "secondary" })}>
                {t`Browse published PMOs`}
                <ArrowRight aria-hidden="true" className="size-4" />
              </RouterLink>
            </JobCard>
          ) : null}
        </div>
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
              {t`What you will need to build a PMO`}
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
