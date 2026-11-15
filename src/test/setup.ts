import "@testing-library/jest-dom/vitest";
// Activates English, the source language, so text in components renders as written.
import "@/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
