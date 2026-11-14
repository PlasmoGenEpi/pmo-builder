import type { Notice } from "@/domain/types";

/** Notices of one kind: the same severity and code. */
export interface NoticeGroup {
  readonly severity: Notice["severity"];
  readonly code: string;
  readonly notices: readonly Notice[];
}

const SEVERITY_ORDER: Readonly<Record<Notice["severity"], number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Groups notices by severity and code, errors first, then warnings, then
 * notes. Within a severity, groups keep the order in which their first notice
 * came. A message repeated word for word is kept once.
 */
export function groupNotices(notices: readonly Notice[]): NoticeGroup[] {
  const groups = new Map<
    string,
    { severity: Notice["severity"]; code: string; notices: Notice[] }
  >();
  for (const notice of notices) {
    const key = `${notice.severity}\u0000${notice.code}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { severity: notice.severity, code: notice.code, notices: [notice] });
    } else if (!group.notices.some((other) => other.message === notice.message)) {
      group.notices.push(notice);
    }
  }
  return [...groups.values()].toSorted(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
