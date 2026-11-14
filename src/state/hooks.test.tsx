import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  TEST_DEPS,
  exampleSuggestMapping,
  fakeParseFile,
  testFieldSet,
} from "@/domain/build/testing";
import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import { createInThreadEngine } from "@/worker/engine";

import {
  AppStoreProvider,
  useActions,
  useDraftSection,
  usePersistence,
  useSectionState,
} from "./hooks";
import { createAppStore } from "./store";

function ProjectStatus() {
  const project = useDraftSection("project");
  const state = useSectionState("project");
  const persistence = usePersistence();
  const actions = useActions();
  const record = project.records[0];
  return (
    <div>
      <p>status: {state?.status ?? "none"}</p>
      <p>saving: {persistence.kind}</p>
      <p>notices: {state?.notices.map((notice) => notice.message).join(" ")}</p>
      <button
        type="button"
        onClick={() => {
          if (record !== undefined)
            actions.setValue({
              list: "projects",
              id: record.id,
              key: "project_name",
              value: "Study",
            });
        }}
      >
        Name it
      </button>
    </div>
  );
}

describe("hooks", () => {
  it("show a section's status and update after an action", async () => {
    const store = createAppStore({
      engine: createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS }),
      storage: createDraftStorage({ openBackend: () => createMemoryBackend() }),
      rebuildDelayMs: 1,
      saveDelayMs: 1,
      suggestMapping: exampleSuggestMapping,
      getFieldSet: testFieldSet,
    });
    render(
      <AppStoreProvider store={store}>
        <ProjectStatus />
      </AppStoreProvider>,
    );
    await act(() => store.getState().actions.initialise());
    await act(() => store.getState().actions.flush());
    expect(screen.getByText("status: empty")).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: "Name it" }).click());
    await act(() => store.getState().actions.flush());
    expect(screen.getByText("status: incomplete")).toBeInTheDocument();
    expect(screen.getByText("notices: Project 1: fill in the description.")).toBeInTheDocument();
    expect(screen.getByText("saving: saved")).toBeInTheDocument();
  });
});
