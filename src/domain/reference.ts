import { z } from "zod";
export const aspects = [
  "Typography",
  "Navigation",
  "Colors",
  "Density",
  "Spacing",
  "Borders",
  "Radius",
  "Elevation",
  "Forms",
  "Tables",
  "Motion",
  "Information Architecture",
] as const;
export const selectionSchema = z.object({
  aspect: z.enum(aspects),
  intent: z.enum(["reference", "avoid"]),
});
export const referenceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().max(2048).default(""),
  selections: z
    .array(selectionSchema)
    .min(1)
    .max(12)
    .refine((v) => new Set(v.map((s) => s.aspect)).size === v.length),
  likes: z.string().max(2000).default(""),
  dislikes: z.string().max(2000).default(""),
});
export const findingSchema = z.object({
  aspect: z.enum(aspects),
  observation: z.string().min(1).max(2000),
  interpretation: z.string().min(1).max(2000),
  recommendation: z.string().min(1).max(2000),
  certainty: z.enum(["low", "medium", "high", "insufficient"]),
  evidence: z.string().min(1).max(2000),
});
export const analysisSchema = z.object({
  referenceId: z.string(),
  findings: z.array(findingSchema).min(1).max(24),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type ReferenceInput = z.infer<typeof referenceInputSchema>;
export type CaptureMetadata = {
  capturedAt: string;
  finalUrl: string;
  viewport: { width: number; height: number };
  structure: {
    title: string;
    headings: { level: string; text: string }[];
    landmarks: Record<string, number>;
    controls: Record<string, number>;
  };
};
export type SavedReference = ReferenceInput & {
  id: string;
  version: number;
  assetId?: string;
  capture?: CaptureMetadata;
  analysis?: Analysis;
  accepted: number[];
  analysisJobId?: string;
};
export type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export type Job = {
  id: string;
  referenceId: string;
  type: "capture" | "analyze";
  state: JobState;
  input: SavedReference;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string; retryable: boolean };
};
