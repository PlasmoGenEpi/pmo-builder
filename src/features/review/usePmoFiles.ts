import { useEffect, useState } from "react";

import { useActions, useAppState } from "@/state";

/** The name and size of one PMO file, as it would download now. */
export interface PmoFileInfo {
  readonly fileName: string;
  /** Bytes, or `null` when the size is left until the file is downloaded. */
  readonly size: number | null;
}

/** The gzipped and plain files, or `null` for each while it is worked out or when it failed. */
export interface PmoFileInfos {
  readonly gzip: PmoFileInfo | null;
  readonly json: PmoFileInfo | null;
}

const NONE: PmoFileInfos = { gzip: null, json: null };

/**
 * Above this many bytes of JSON, compressing the PMO just to show its size
 * takes long enough to notice, so the gzipped size waits for the download.
 */
export const GZIP_SIZE_LIMIT = 25 * 1024 * 1024;

/** A file name from the plain one, for the gzipped file whose size is not worked out. */
function gzipName(jsonName: string): string {
  return `${jsonName}.gz`;
}

/**
 * The file name and size of the plain and the gzipped PMO, worked out again
 * after each build that gives a PMO. Both are `null` when there is no PMO.
 *
 * Sizes come from `pmoFileSize`, which is not a download and is not counted
 * as one. The plain size comes first. The gzipped size follows, except for a
 * PMO over {@link GZIP_SIZE_LIMIT} of JSON, where it is left until the user
 * downloads; the worker keeps each file it makes, so a download reuses it.
 */
export function usePmoFiles(): PmoFileInfos {
  const actions = useActions();
  const revision = useAppState((state) =>
    state.build.view?.overall.pmo === "none" ? null : (state.build.view?.revision ?? null),
  );
  const [result, setResult] = useState<{
    readonly revision: number;
    readonly files: PmoFileInfos;
  } | null>(null);
  useEffect(() => {
    let current = true;
    const measure = async (gzip: boolean): Promise<PmoFileInfo | null> => {
      try {
        return await actions.pmoFileSize({ gzip });
      } catch {
        return null;
      }
    };
    const load = async (at: number): Promise<void> => {
      const json = await measure(false);
      if (!current) return;
      setResult((previous) => ({
        revision: at,
        files: { gzip: previous?.files.gzip ?? null, json },
      }));
      const gzip =
        json !== null && json.size !== null && json.size > GZIP_SIZE_LIMIT
          ? { fileName: gzipName(json.fileName), size: null }
          : await measure(true);
      if (current) setResult({ revision: at, files: { gzip, json } });
    };
    if (revision !== null) void load(revision);
    return () => {
      current = false;
    };
  }, [actions, revision]);
  if (revision === null || result === null) return NONE;
  // Keep the last sizes on screen while a newer build is measured.
  return result.files;
}
