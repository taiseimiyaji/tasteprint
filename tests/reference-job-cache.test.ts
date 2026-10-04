import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  commitReferenceJob,
  type ReferenceData,
} from "../src/client/query-cache";
import type { Job, SavedReference } from "../src/domain/reference";
const reference: SavedReference = {
  id: "one",
  version: 2,
  name: "Saved",
  url: "https://job.example",
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "saved notes",
  dislikes: "",
  accepted: [0],
};
const job = (id: string, state: Job["state"], second = 1): Job => ({
  id,
  state,
  referenceId: reference.id,
  type: "capture",
  input: reference,
  createdAt: `2026-10-04T00:00:0${second}Z`,
  updatedAt: `2026-10-04T00:00:0${second}Z`,
});
describe("accepted Reference job replies", () => {
  it("cancels an exact stale list without canceling another scope or replacing references", async () => {
    const client = new QueryClient();
    const data: ReferenceData = { references: [reference], jobs: [] };
    client.setQueryData(["references", "profile"], data);
    let release!: (data: ReferenceData) => void;
    const read = client
      .fetchQuery({
        queryKey: ["references", "profile"],
        queryFn: () =>
          new Promise<ReferenceData>((resolve) => {
            release = resolve;
          }),
      })
      .catch(() => undefined);
    let otherRelease!: (data: ReferenceData) => void;
    const other = client.fetchQuery({
      queryKey: ["references", "project"],
      queryFn: () =>
        new Promise<ReferenceData>((resolve) => {
          otherRelease = resolve;
        }),
    });
    await commitReferenceJob(client, "profile", job("new", "running"));
    release(data);
    otherRelease(data);
    await read;
    expect(await other).toEqual(data);
    expect(client.getQueryData(["references", "profile"])).toEqual({
      references: [reference],
      jobs: [job("new", "running")],
    });
    client.clear();
  });
  it("keeps terminal state when an older acceptance arrives even with the same timestamp", async () => {
    const client = new QueryClient();
    await commitReferenceJob(client, "profile", job("one", "canceled"));
    await commitReferenceJob(client, "profile", job("one", "running"));
    const data = client.getQueryData<ReferenceData>(["references", "profile"]);
    expect(data?.jobs).toEqual([job("one", "canceled")]);
    await commitReferenceJob(client, "profile", {
      ...job("one", "failed"),
      updatedAt: "2026-10-04T00:00:00Z",
    });
    expect(
      client.getQueryData<ReferenceData>(["references", "profile"])?.jobs,
    ).toEqual(data?.jobs);
    client.clear();
  });
  it("deduplicates job IDs and preserves creation order for replies delivered out of order", async () => {
    const client = new QueryClient();
    await commitReferenceJob(client, "project", job("newer", "running", 2));
    await commitReferenceJob(client, "project", job("older", "failed", 1));
    await commitReferenceJob(client, "project", {
      ...job("newer", "canceled", 2),
      updatedAt: "2026-10-04T00:00:03Z",
    });
    expect(
      client
        .getQueryData<ReferenceData>(["references", "project"])
        ?.jobs.map((j) => [j.id, j.state]),
    ).toEqual([
      ["older", "failed"],
      ["newer", "canceled"],
    ]);
    expect(client.getQueryData(["references", "profile"])).toBeUndefined();
    client.clear();
  });
});
