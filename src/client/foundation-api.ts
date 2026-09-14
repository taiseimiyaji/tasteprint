import { designSchema, type Design } from "../domain/design";
export type Revision = {
  snapshot?: import("../domain/projects").ProjectSnapshot;
  revision: number;
  design: Design;
  reason: string;
  createdAt: string;
  decisions?: {
    targetPath: string;
    rationale: string;
    source: string;
    author: "user" | "ai";
  }[];
};
export type Candidate = {
  id: string;
  baseRevision: number;
  design: Design;
  explanation: string;
};
export async function foundationRequest<T>(
  path: string,
  body?: unknown,
  base = "/api/references/foundation",
): Promise<T> {
  const response = await fetch(`${base}${path === "/" ? "" : path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "入力内容を確認してください。");
  return data;
}
export function parseRevision(value: Revision): Revision {
  return { ...value, design: designSchema.parse(value.design) };
}
