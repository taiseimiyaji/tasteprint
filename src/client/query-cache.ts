import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Job, SavedReference } from "../domain/reference";
import type { ProjectSnapshot, TasteRevision } from "../domain/projects";
import type { ExportRecord, Project } from "../server/projects/service";
import type { Revision } from "./foundation-api";

export type ProjectData = {
  project: Project;
  current: Revision & { snapshot: ProjectSnapshot };
};
type ProfileData = { current: TasteRevision; history: TasteRevision[] };
const projectStatusWrites = new WeakMap<QueryClient, Map<string, number>>();

// Archive/unarchive does not advance the server revision. Keep client write order
// across ProjectList unmounts, where a component ref would lose the next write.
export function beginProjectStatusWrite(client: QueryClient, id: string) {
  let writes = projectStatusWrites.get(client);
  if (!writes) projectStatusWrites.set(client, (writes = new Map()));
  const ticket = (writes.get(id) ?? 0) + 1;
  writes.set(id, ticket);
  return () => writes.get(id) === ticket;
}

// A read started before this reply must not replace the accepted update.
export async function commitQuery<T>(
  client: QueryClient,
  key: QueryKey,
  update: (previous: T | undefined) => T | undefined,
) {
  await client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData<T>(key, update);
}

export async function commitProfile(client: QueryClient, reply: TasteRevision) {
  await commitQuery<ProfileData>(client, ["profile"], (data) =>
    data && data.current.revision > reply.revision
      ? data
      : {
          current: reply,
          history: [
            ...(data?.history ?? []).filter(
              (r) => r.revision !== reply.revision,
            ),
            reply,
          ].sort((a, b) => a.revision - b.revision),
        },
  );
}

export async function commitProject(
  client: QueryClient,
  reply: Project,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return;
  const merge = (previous: Project): Project => ({
    ...reply,
    latestExport:
      previous.latestExport &&
      (!reply.latestExport ||
        previous.latestExport.createdAt > reply.latestExport.createdAt)
        ? previous.latestExport
        : reply.latestExport,
  });
  await Promise.all([
    commitQuery<Project[]>(client, ["projects"], (projects) =>
      !isCurrent()
        ? projects
        : projects?.some((p) => p.id === reply.id)
          ? projects.map((p) =>
              p.id === reply.id && p.activeRevision <= reply.activeRevision
                ? merge(p)
                : p,
            )
          : [...(projects ?? []), reply],
    ),
    commitQuery<ProjectData>(client, ["project", reply.id], (data) =>
      isCurrent() && data && data.current.revision === reply.activeRevision
        ? { ...data, project: merge(data.project) }
        : data,
    ),
  ]);
}

export async function commitProjectRevision(
  client: QueryClient,
  id: string,
  reply: Revision,
) {
  if (!reply.snapshot) return;
  const current = { ...reply, snapshot: reply.snapshot };
  const update = (project: Project): Project =>
    project.activeRevision > reply.revision
      ? project
      : {
          ...project,
          brief: current.snapshot.brief,
          activeRevision: reply.revision,
          updatedAt: reply.createdAt,
        };
  await Promise.all([
    commitQuery<ProjectData>(client, ["project", id], (data) =>
      data &&
      data.current.revision <= reply.revision &&
      data.project.activeRevision <= reply.revision
        ? { current, project: update(data.project) }
        : data,
    ),
    commitQuery<Project[]>(client, ["projects"], (projects) =>
      projects?.map((project) =>
        project.id === id ? update(project) : project,
      ),
    ),
  ]);
}

export async function commitExport(client: QueryClient, reply: ExportRecord) {
  const update = (project: Project): Project =>
    project.latestExport && project.latestExport.createdAt > reply.createdAt
      ? project
      : { ...project, latestExport: reply };
  await Promise.all([
    commitQuery<ExportRecord[]>(
      client,
      ["exports", reply.projectId],
      (records) =>
        [reply, ...(records ?? []).filter((r) => r.id !== reply.id)].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt),
        ),
    ),
    commitQuery<Project[]>(client, ["projects"], (projects) =>
      projects?.map((project) =>
        project.id === reply.projectId ? update(project) : project,
      ),
    ),
    commitQuery<ProjectData>(client, ["project", reply.projectId], (data) =>
      data ? { ...data, project: update(data.project) } : data,
    ),
  ]);
}

export type ReferenceData = { references: SavedReference[]; jobs: Job[] };

export async function commitReferenceJob(
  client: QueryClient,
  scopeId: string,
  reply: Job,
) {
  await commitQuery<ReferenceData>(client, ["references", scopeId], (data) => {
    const previous = data?.jobs.find((job) => job.id === reply.id);
    const active = (job: Job) => ["queued", "running"].includes(job.state);
    // Jobs never restart under the same ID. A late accepted reply must not
    // restore active controls after a cancellation or completed poll.
    if (
      previous &&
      ((!active(previous) && active(reply)) ||
        previous.updatedAt > reply.updatedAt)
    )
      return data;
    return {
      references: data?.references ?? [],
      jobs: [
        ...(data?.jobs ?? []).filter((job) => job.id !== reply.id),
        reply,
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  });
}
