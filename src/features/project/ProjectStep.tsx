import { FolderOpen } from "lucide-react";

import { StepPage } from "@/app/StepPage";
import { PROJECT_FORM_FIELDS, isBlankRecord, type ProjectRecord } from "@/domain/draft";
import {
  EntryModeSwitch,
  NameCoverage,
  RecordForm,
  RecordList,
  StepIntro,
  recordState,
  splitOneLineList,
} from "@/features/records";
import { SectionResult } from "@/features/shared";
import { TableImport } from "@/features/table-import";
import { useActions, useDraftSection, useSuggestions } from "@/state";

const LIST = { list: "projects" } as const;

function projectTitle(record: ProjectRecord, index: number, count: number): string {
  const name = record.values.project_name.trim();
  if (name !== "") return name;
  return count === 1 ? "Your project" : `Project ${index + 1}`;
}

/** The projects typed in: usually one form, shown straight away. */
function ProjectRecords() {
  const { records } = useDraftSection("project");
  const actions = useActions();
  const suggestions = useSuggestions();
  const defined = records.map((record) => record.values.project_name);

  const addNamed = (names: readonly string[]): void => {
    const blanks = records.filter(isBlankRecord).map((record) => record.id);
    for (const name of names) {
      const id = blanks.shift() ?? actions.addItem(LIST);
      actions.setValue({ ...LIST, id, key: "project_name", value: name });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <NameCoverage
        referenced={suggestions.projectNames}
        defined={defined}
        source="specimen table"
        noun="project"
        onCreate={addNamed}
      />
      <RecordList
        items={records}
        noun="project"
        title={(record, index) => projectTitle(record, index, records.length)}
        isBlank={isBlankRecord}
        state={(record) => recordState(PROJECT_FORM_FIELDS, record.values, record.extra)}
        onAdd={() => actions.addItem(LIST)}
        onRemove={(id) => actions.removeItem(LIST, id)}
        addLabel={records.length === 1 ? "Add another project" : "Add a project"}
        empty={{
          icon: FolderOpen,
          title: "No project yet",
          description: "Add the project this data belongs to: its name and a short description.",
        }}
      >
        {(record) => (
          <RecordForm
            fields={PROJECT_FORM_FIELDS}
            values={record.values}
            onValueChange={(key, value) => actions.setValue({ ...LIST, id: record.id, key, value })}
            suggestions={{ project_name: suggestions.projectNames }}
            fixes={{ project_contributors: splitOneLineList }}
            extra={{
              entries: record.extra,
              onUpdate: (recipe) =>
                actions.updateItem({
                  list: "projects",
                  id: record.id,
                  recipe: (current) => ({ ...current, extra: recipe(current.extra) }),
                }),
            }}
          />
        )}
      </RecordList>
    </div>
  );
}

/**
 * The project step: who ran the study. One project typed in by default, or a
 * project table for the rare user with several.
 */
export function ProjectStep() {
  const project = useDraftSection("project");
  const actions = useActions();
  return (
    <StepPage stepId="project">
      <div className="flex flex-col gap-10">
        <StepIntro>
          Optional. The project gives the PMO a name and description for your study, and the people
          behind it, so others can tell where the data came from.
        </StepIntro>
        <EntryModeSwitch
          label="How to enter projects"
          mode={project.mode}
          onModeChange={(mode) => actions.setMode({ target: "project", mode })}
          manualHasContent={project.records.some((record) => !isBlankRecord(record))}
          tableHasContent={project.table !== null}
          hint={
            project.mode === "manual"
              ? "Have several projects in a spreadsheet? Use a file."
              : undefined
          }
          manual={<ProjectRecords />}
          table={
            <TableImport
              slot={{ section: "project" }}
              label="Project table"
              description="One row for each project, with its name and description."
            />
          }
        />
        <SectionResult
          section="project"
          emptyMessage="Nothing here yet. Fill in the project name and description above to add them to the PMO."
          stats={(summary) => [
            {
              label: summary.projects === 1 ? "Project" : "Projects",
              value: summary.projects,
              hint: summary.names.length > 0 ? summary.names.slice(0, 3).join(", ") : undefined,
            },
          ]}
        />
      </div>
    </StepPage>
  );
}
