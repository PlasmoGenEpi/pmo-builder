// Applies the saved light or dark choice before the page first paints, so a
// user whose choice differs from the system's sees no flash of the other
// theme. It is a file, not an inline script, because the Content Security
// Policy allows scripts from this site only. The key is THEME_STORAGE_KEY in
// src/app/theme.ts; with no saved choice the CSS follows the system setting.
try {
  const theme = window.localStorage.getItem("pmo-builder.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be blocked. The page then follows the system setting.
}
