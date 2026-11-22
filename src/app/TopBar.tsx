import { t } from "@lingui/core/macro";
import { Ellipsis, Menu as MenuIcon, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";
import { Link as RouterLink, useLocation } from "wouter";

import { chooseLanguage, currentLocale, LANGUAGES, OFFERED } from "@/i18n";
import { zenodoConfig } from "@/features/review/zenodo";
import { IconButton, Menu, cn } from "@/ui";

import { Logo } from "./Logo";
import { PrivacyIndicator } from "./privacy/PrivacyIndicator";
import { StartOverDialog } from "./StartOver";
import { SaveStatus } from "./SaveStatus";
import { BUILD_PATH } from "./steps";
import { useTheme, type ThemePreference } from "./theme";

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** The app's sections, in the top bar. */
interface Section {
  readonly href: string;
  readonly label: string;
  /** Whether `location` is in the section. */
  readonly matches: (location: string) => boolean;
}

function within(prefix: string) {
  return (location: string): boolean => location === prefix || location.startsWith(`${prefix}/`);
}

function sections(showPublished: boolean): Section[] {
  return [
    {
      href: BUILD_PATH,
      label: t({ message: "Build", comment: "Top bar section: building a PMO from tables" }),
      matches: within(BUILD_PATH),
    },
    {
      href: "/pmo",
      label: t({
        message: "My PMO file",
        comment: "Top bar section: working with a PMO file the user has",
      }),
      matches: within("/pmo"),
    },
    ...(showPublished
      ? [
          {
            href: "/published",
            label: t({ message: "Published", comment: "Top bar section: published PMOs" }),
            matches: within("/published"),
          },
        ]
      : []),
  ];
}

/** Props for {@link TopBar}. */
export interface TopBarProps {
  /** Opens the step list on narrow screens. Only in the Build section. */
  onOpenNav: () => void;
  /** Whether to offer the published PMOs. Default: when a Zenodo community is set. */
  showPublished?: boolean;
}

/** The bar across the top: app name, the sections, the privacy promise and the overflow menu. */
export function TopBar({ onOpenNav, showPublished = zenodoConfig() !== null }: TopBarProps) {
  const { preference, setPreference } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [location] = useLocation();
  const building = within(BUILD_PATH)(location);

  return (
    <header className="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-x-2 border-b border-border bg-surface md:h-topbar md:flex-nowrap md:gap-3 md:px-4">
      {building ? (
        <IconButton
          label={t`Open the step list`}
          icon={MenuIcon}
          onClick={onOpenNav}
          className="my-1.5 ml-3 lg:hidden md:my-0 md:ml-0"
        />
      ) : null}
      <RouterLink
        href="/"
        className={cn(
          "my-2 flex shrink-0 items-center gap-2.5 rounded-md py-1 pr-1.5 text-md font-semibold tracking-tight text-text md:my-0",
          !building && "ml-3 md:ml-0",
        )}
      >
        <Logo />
        <span>PMO Builder</span>
      </RouterLink>
      <nav
        aria-label={t`Sections`}
        className="order-last flex basis-full items-center gap-1 overflow-x-auto border-t border-border px-2 py-1 md:order-none md:ml-4 md:shrink-0 md:basis-auto md:overflow-visible md:border-t-0 md:p-0"
      >
        {sections(showPublished).map((section) => {
          const active = section.matches(location);
          return (
            <RouterLink
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-base whitespace-nowrap transition-colors duration-100",
                active
                  ? "bg-accent-subtle font-medium text-accent-text"
                  : "text-text-muted hover:bg-surface-muted hover:text-text",
              )}
            >
              {section.label}
            </RouterLink>
          );
        })}
      </nav>
      <div className="my-1.5 mr-3 ml-auto flex min-w-0 items-center gap-1 md:my-0 md:mr-0 md:gap-2">
        {building ? <SaveStatus /> : null}
        <PrivacyIndicator />
        <Menu
          trigger={<IconButton label={t`More options`} icon={Ellipsis} />}
          entries={[
            {
              kind: "radio",
              label: t`Theme`,
              value: preference,
              onValueChange: (value) => {
                if (isPreference(value)) setPreference(value);
              },
              options: [
                { value: "system", label: t`Match my device`, icon: Monitor },
                {
                  value: "light",
                  label: t({ message: "Light", comment: "Theme name" }),
                  icon: Sun,
                },
                { value: "dark", label: t({ message: "Dark", comment: "Theme name" }), icon: Moon },
              ],
            },
            ...(OFFERED.length > 1
              ? [
                  {
                    kind: "radio" as const,
                    label: t`Language`,
                    value: currentLocale(),
                    onValueChange: (value: string) => {
                      const language = OFFERED.find((code) => code === value);
                      if (language !== undefined) chooseLanguage(language);
                    },
                    options: LANGUAGES.filter((language) =>
                      OFFERED.some((code) => code === language.code),
                    ).map((language) => ({ value: language.code, label: language.name })),
                  },
                ]
              : []),
            { kind: "separator" },
            {
              kind: "item",
              label: t`Start over`,
              icon: RotateCcw,
              danger: true,
              onSelect: () => setConfirming(true),
            },
          ]}
        />
      </div>
      <StartOverDialog open={confirming} onOpenChange={setConfirming} />
    </header>
  );
}
