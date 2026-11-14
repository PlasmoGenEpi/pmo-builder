import { describe, expectTypeOf, it } from "vitest";

import type { FieldSetId, SectionId, SectionStatus } from "@/domain/types";

import type { AnalyticsSection, AnalyticsSectionStatus, AnalyticsTable } from "./vocabulary";

// These checks run in `pnpm typecheck`. If the domain adds a section, a table
// or a status, update the lists in vocabulary.ts and the JSON Schema.
describe("vocabulary", () => {
  it("matches the domain types", () => {
    expectTypeOf<AnalyticsSection>().toEqualTypeOf<SectionId>();
    expectTypeOf<AnalyticsTable>().toEqualTypeOf<FieldSetId>();
    expectTypeOf<AnalyticsSectionStatus>().toEqualTypeOf<SectionStatus>();
  });
});
