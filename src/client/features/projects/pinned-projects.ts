const pinnedProjectsStorageKey = "aeroplane:pinned-projects";

export function readPinnedProjectIds() {
  try {
    const stored = window.localStorage.getItem(pinnedProjectsStorageKey);
    if (!stored) return [];

    const value: unknown = JSON.parse(stored);
    return value !== null && Array.isArray(value)
      ? value.filter((projectId): projectId is string => typeof projectId === "string")
      : [];
  } catch {
    return [];
  }
}

export function writePinnedProjectIds(projectIds: string[]) {
  try {
    window.localStorage.setItem(pinnedProjectsStorageKey, JSON.stringify(projectIds));
  } catch {
    // Browsers can disable storage; pinning still works for the current session.
  }
}
