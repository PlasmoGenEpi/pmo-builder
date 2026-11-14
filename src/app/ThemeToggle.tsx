import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/ui";

import { useTheme } from "./theme";

/** Switches between the light and dark theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  return (
    <IconButton
      label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      icon={resolved === "dark" ? Sun : Moon}
      onClick={toggle}
      className={className}
    />
  );
}
