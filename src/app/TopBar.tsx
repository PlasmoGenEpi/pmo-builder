import { t } from "@lingui/core/macro";
import { Ellipsis, Menu as MenuIcon, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";
import { Link as RouterLink } from "wouter";

import { chooseLanguage, currentLocale, LANGUAGES, OFFERED } from "@/i18n";
import { IconButton, Menu } from "@/ui";

import { Logo } from "./Logo";
import { PrivacyIndicator } from "./privacy/PrivacyIndicator";
import { StartOverDialog } from "./StartOver";
import { SaveStatus } from "./SaveStatus";
import { useTheme, type ThemePreference } from "./theme";
import { ThemeToggle } from "./ThemeToggle";

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Props for {@link TopBar}. */
export interface TopBarProps {
  /** Opens the step list on narrow screens. */
  onOpenNav: () => void;
}

/** The slim bar across the top: app name, privacy promise, theme and the overflow menu. */
export function TopBar({ onOpenNav }: TopBarProps) {
  const { preference, setPreference } = useTheme();
  const [confirming, setConfirming] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-3 sm:px-4">
      <IconButton
        label={t`Open the step list`}
        icon={MenuIcon}
        onClick={onOpenNav}
        className="lg:hidden"
      />
      <RouterLink
        href="/"
        className="flex shrink-0 items-center gap-2.5 rounded-md py-1 pr-1.5 text-md font-semibold tracking-tight text-text"
      >
        <Logo />
        <span className="hidden sm:inline">PMO Builder</span>
        <span className="sr-only sm:hidden">{t`PMO Builder home`}</span>
      </RouterLink>
      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
        <SaveStatus />
        <PrivacyIndicator />
        <span className="hidden sm:contents">
          <ThemeToggle />
        </span>
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
