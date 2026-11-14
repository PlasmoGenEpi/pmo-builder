import { describe, expect, it } from "vitest";

import type { Notice } from "@/domain/types";

import { crossSectionNotices } from "./crossSection";

const notice = (code: string, severity: Notice["severity"] = "warning"): Notice => ({
  severity,
  code,
  message: code,
  sections: ["specimens", "project"],
});

describe("crossSectionNotices", () => {
  it("leaves out unlinked names, which the step's own name check already shows", () => {
    const overall = [
      notice("draft/unlinked-project-names"),
      notice("draft/one-project-for-all", "info"),
      notice("draft/section-left-out"),
    ];
    expect(crossSectionNotices(overall, "specimens").map((n) => n.code)).toEqual([
      "draft/one-project-for-all",
    ]);
  });
});
