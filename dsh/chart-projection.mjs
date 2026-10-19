// A session-owned read model of settled chart metadata. It does not depend on
// transcript widgets mounting, expanding, or remaining in the virtual viewport.
import { z } from "zod";
import { DSH_CHART_META_SCHEMA } from "./pi-api.mjs";

export const CHART_PROJECTION_KEY = "piSparklesCharts";
export const MAX_FLOATING_CHARTS = 12;
const MAX_META_BYTES = 512 * 1024;
const metaSchema = z.object({
  schema: z.literal(DSH_CHART_META_SCHEMA), schemaVersion: z.literal(1), valid: z.literal(true),
  chart: z.object({ bars: z.array(z.json()).min(1).max(240) }).passthrough(),
}).passthrough();
const viewSchema = z.object({
  sessionId: z.string(),
  charts: z.array(z.object({ id: z.string(), meta: metaSchema })).max(MAX_FLOATING_CHARTS),
  omittedCharts: z.number().int().nonnegative(),
});

export function chartProjection() {
  return {
    key: CHART_PROJECTION_KEY, stateVersion: 1, stateSchema: viewSchema,
    init: (header) => ({ sessionId: String(header.id), charts: [], omittedCharts: 0 }),
    apply(state, event) {
      let id;
      if (event.type === "tool/result" && event.data?.message?.isError === false) {
        id = event.data.message.toolCallId;
      } else if (event.type === "tool/ptc-dispatch" && event.data?.isError === false && event.data.name === "chart_ohlcv") {
        id = event.data.subCallId;
      }
      if (typeof id !== "string" || id.length === 0) return state;
      const meta = event.data.meta;
      if (!metaSchema.safeParse(meta).success || Buffer.byteLength(JSON.stringify(meta)) > MAX_META_BYTES) return state;
      // A replayed/replaced call keeps one card and its original stack position.
      const existing = state.charts.findIndex((chart) => chart.id === id);
      if (existing !== -1) {
        const charts = state.charts.slice();
        charts[existing] = { id, meta };
        return { ...state, charts };
      }
      const charts = [...state.charts, { id, meta }];
      return { ...state, charts: charts.slice(-MAX_FLOATING_CHARTS),
        omittedCharts: state.omittedCharts + Math.max(0, charts.length - MAX_FLOATING_CHARTS) };
    },
    wire: { viewSchema, view: (state) => state },
  };
}
