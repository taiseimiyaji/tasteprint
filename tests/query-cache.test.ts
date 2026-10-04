import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { defaultDesign } from "../src/domain/design";
import {
  emptyTaste,
  type TasteRevision,
  type ProjectSnapshot,
  type Conversation,
} from "../src/domain/projects";
import type { Project, ExportRecord } from "../src/server/projects/service";
import {
  commitExport,
  commitConversation,
  beginProjectStatusWrite,
  commitProject,
  commitProfile,
  commitProjectRevision,
  type ProjectData,
} from "../src/client/query-cache";

const taste = (revision: number): TasteRevision => ({
  revision,
  createdAt: `2026-10-04T00:00:0${revision}Z`,
  snapshot: emptyTaste(),
});
const project: Project = {
  id: "one",
  slug: "one",
  createdAt: "2026-10-04T00:00:00Z",
  archivedAt: null,
  activeRevision: 1,
  updatedAt: "2026-10-04T00:00:01Z",
  brief: { name: "One", purpose: "", audience: "", desired: "", avoid: "" },
  latestExport: null,
};
const snapshot: ProjectSnapshot = {
  projectId: project.id,
  brief: project.brief,
  sourceTasteProfileRevision: null,
  taste: emptyTaste(),
  policies: [],
  references: [],
  maintained: [],
};
const revision = (value: number) => ({
  revision: value,
  createdAt: `2026-10-04T00:00:0${value}Z`,
  design: defaultDesign,
  reason: "test",
  snapshot,
});
const record = (id: string, second: number): ExportRecord => ({
  id,
  projectId: project.id,
  revision: 1,
  sourceTasteProfileRevision: null,
  createdAt: `2026-10-04T00:00:0${second}Z`,
  files: { [`${id}.json`]: "" },
});

describe("accepted mutation replies remain authoritative in shared queries", () => {
  it("merges late conversation replies by server order, keeps identical text under distinct IDs, and cancels only the matching read", async () => {
    const client = new QueryClient();
    const message = (id: string, sequence: number): Conversation => ({
      id,
      sequence,
      projectId: "one",
      baseRevision: 1,
      text: "same instruction",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const a = message("a", 1),
      b = message("b", 2),
      c = { ...message("c", 3), createdAt: "2025-10-04T00:00:00.000Z" };
    await commitConversation(client, b);
    let release!: (value: Conversation[]) => void;
    const pending = client
      .fetchQuery({
        queryKey: ["conversations", "one"],
        queryFn: () =>
          new Promise<Conversation[]>((resolve) => (release = resolve)),
      })
      .catch(() => undefined);
    let otherRelease!: (value: Conversation[]) => void;
    const other = { ...message("other", 1), projectId: "two" };
    const otherPending = client.fetchQuery({
      queryKey: ["conversations", "two"],
      queryFn: () =>
        new Promise<Conversation[]>((resolve) => (otherRelease = resolve)),
    });
    await commitConversation(client, a);
    release([]);
    otherRelease([other]);
    await pending;
    expect(await otherPending).toEqual([other]);
    await commitConversation(client, c);
    await commitConversation(client, b);
    expect(client.getQueryData(["conversations", "one"])).toEqual([a, b, c]);
    expect(client.getQueryData(["conversations", "two"])).toEqual([other]);
    client.clear();
  });
  it("cancels the old exact read without cancelling another scope", async () => {
    const client = new QueryClient();
    client.setQueryData(["profile"], {
      current: taste(1),
      history: [taste(1)],
    });
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => (release = resolve));
    const pending = client
      .fetchQuery({ queryKey: ["profile"], queryFn: () => gate })
      .catch(() => undefined);
    let otherRelease!: (value: string) => void;
    const other = client.fetchQuery({
      queryKey: ["other"],
      queryFn: () => new Promise<string>((resolve) => (otherRelease = resolve)),
    });
    await commitProfile(client, taste(2));
    release({ current: taste(1), history: [taste(1)] });
    otherRelease("kept");
    await pending;
    expect(await other).toBe("kept");
    expect(client.getQueryData(["profile"])).toEqual({
      current: taste(2),
      history: [taste(1), taste(2)],
    });
    client.clear();
  });
  it("a late lower revision cannot roll either Profile or Project caches back", async () => {
    const client = new QueryClient();
    await commitProfile(client, taste(3));
    await commitProfile(client, taste(2));
    client.setQueryData<ProjectData>(["project", project.id], {
      project,
      current: revision(1),
    });
    const otherProject = {
      ...project,
      id: "two",
      brief: { ...project.brief, name: "Other" },
    };
    client.setQueryData(["projects"], [project, otherProject]);
    await commitProjectRevision(client, project.id, revision(3));
    await commitProjectRevision(client, project.id, revision(2));
    expect(
      client.getQueryData<{ current: TasteRevision }>(["profile"])?.current
        .revision,
    ).toBe(3);
    expect(
      client.getQueryData<ProjectData>(["project", project.id])?.current
        .revision,
    ).toBe(3);
    const list = client.getQueryData<Project[]>(["projects"])!;
    expect(list[0].activeRevision).toBe(3);
    expect(list[1]).toEqual(otherProject);
    client.clear();
  });
  it("reusing an earlier Export keeps the newest summary and deduplicates history", async () => {
    const client = new QueryClient();
    client.setQueryData(["projects"], [project]);
    client.setQueryData<ProjectData>(["project", project.id], {
      project,
      current: revision(1),
    });
    await commitExport(client, record("old", 1));
    await commitExport(client, record("new", 2));
    await commitExport(client, record("old", 1));
    expect(
      client
        .getQueryData<ExportRecord[]>(["exports", project.id])
        ?.map((r) => r.id),
    ).toEqual(["new", "old"]);
    expect(
      client.getQueryData<Project[]>(["projects"])?.[0].latestExport?.id,
    ).toBe("new");
    expect(
      client.getQueryData<ProjectData>(["project", project.id])?.project
        .latestExport?.id,
    ).toBe("new");
    client.clear();
  });
  it("an older archive reply cannot replace a later unarchive across an awaited cancellation", async () => {
    const client = new QueryClient();
    client.setQueryData(["projects"], [project]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(client, "cancelQueries").mockImplementationOnce(() => gate);
    const first = beginProjectStatusWrite(client, project.id);
    const oldReply = commitProject(
      client,
      { ...project, archivedAt: "old" },
      first,
    );
    const second = beginProjectStatusWrite(client, project.id);
    await commitProject(client, project, second);
    release();
    await oldReply;
    expect(
      client.getQueryData<Project[]>(["projects"])?.[0].archivedAt,
    ).toBeNull();
    client.clear();
  });
  it("a delayed Project status reply retains an Export accepted in the meantime", async () => {
    const client = new QueryClient();
    client.setQueryData(["projects"], [project]);
    client.setQueryData<ProjectData>(["project", project.id], {
      project,
      current: revision(1),
    });
    const current = beginProjectStatusWrite(client, project.id);
    await commitExport(client, record("after-status-request", 2));
    await commitProject(client, project, current);
    expect(
      client.getQueryData<Project[]>(["projects"])?.[0].latestExport?.id,
    ).toBe("after-status-request");
    expect(
      client.getQueryData<ProjectData>(["project", project.id])?.project
        .latestExport?.id,
    ).toBe("after-status-request");
    client.clear();
  });
});
