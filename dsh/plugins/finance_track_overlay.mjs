// DSH-owned read model for Pi Sparkles status entries. The track plugin keeps
// its Gleam state/receipt logic; the Pi facade records each status update as a
// whole-value DSH session event and this projection exposes the latest values
// to the browser client.

import { z } from "zod";
import { DSH_STATUS_EVENT } from "../pi-api.mjs";

export const STATUS_PROJECTION_KEY = "piSparklesStatus";

const statusState = z.record(z.string(), z.string());
const statusView = z.object({ values: statusState });

export function statusProjection() {
  return {
    key: STATUS_PROJECTION_KEY,
    stateSchema: statusState,
    init: () => ({}),
    apply(state, event) {
      if (
        event?.type !== DSH_STATUS_EVENT ||
        typeof event.data?.key !== "string" ||
        (event.data.text !== null && typeof event.data.text !== "string")
      ) {
        return state;
      }
      const values = { ...state };
      if (event.data.text === null) delete values[event.data.key];
      else values[event.data.key] = event.data.text;
      return values;
    },
    wire: {
      viewSchema: statusView,
      view: (state) => ({ values: state }),
    },
    stateVersion: 1,
  };
}

export default {
  name: "dsh-sparkles-finance-track-overlay",
  inject: ["sessionProjections"],
  apply(ctx) {
    ctx.sessionProjections.register(statusProjection());
  },
};
