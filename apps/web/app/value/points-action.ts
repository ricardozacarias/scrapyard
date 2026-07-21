"use server";

import { getModelPoints, type ModelPoint } from "@/lib/fair-price";

// De-identified scatter points for one model (numeric attributes only — same
// exposure class as the /analysis scatter, see CLAUDE.md). One cohort per call,
// capped in getModelPoints.
export async function fetchModelPoints(key: string): Promise<ModelPoint[]> {
  if (typeof key !== "string" || key.length > 100) return [];
  return getModelPoints(key);
}
