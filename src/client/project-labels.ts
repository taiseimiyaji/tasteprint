import type { Project } from "../server/projects/service";

type NamedProject = Pick<Project, "id" | "brief" | "createdAt">;

/** Stable labels for projects that share a name, regardless of list order or archive state. */
export function duplicateProjectLabels(projects: readonly NamedProject[]) {
  const groups = new Map<string, NamedProject[]>();
  for (const project of projects) {
    const group = groups.get(project.brief.name) ?? [];
    group.push(project);
    groups.set(project.brief.name, group);
  }
  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .forEach((project, index) =>
        labels.set(project.id, `同名 ${index + 1}/${group.length}`),
      );
  }
  return labels;
}

export function projectChoiceName(
  project: Pick<Project, "id" | "brief">,
  duplicateLabels: ReadonlyMap<string, string>,
) {
  const duplicate = duplicateLabels.get(project.id);
  return `${project.brief.name}${duplicate ? `（${duplicate}）` : ""}`;
}
