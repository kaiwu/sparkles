import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { remember_tool } from "../durable_bridge_ffi.mjs";

function registerTool(api, definition) {
  api.registerTool(definition);
  remember_tool(api, definition);
}

const COMPACT_CONTENT_MARGIN = 4;

function contentWidth(width) {
  const available = Number.isInteger(width) && width > 0 ? width : 80;
  return Math.max(1, available - COMPACT_CONTENT_MARGIN);
}

class CompactText {
  constructor(text = "") {
    this.text = text;
  }

  setText(text) {
    this.text = text;
  }

  invalidate() {}

  render(width) {
    if (this.text.trim() === "") return [];
    const maximum = contentWidth(width);
    return this.text.split("\n").map((line) =>
      visibleWidth(line) <= maximum
        ? line
        : truncateToWidth(line, maximum, ""),
    );
  }
}

export function register(
  api,
  name,
  label,
  description,
  promptSnippet,
  parameters,
  executionMode,
  execute,
) {
  registerTool(api, {
    name,
    label,
    description,
    ...(promptSnippet === "" ? {} : { promptSnippet }),
    parameters,
    ...(executionMode === "" ? {} : { executionMode }),
    execute,
  });
}

export function register_compact(
  api,
  name,
  label,
  description,
  promptSnippet,
  parameters,
  executionMode,
  execute,
) {
  registerTool(api, {
    name,
    label,
    description,
    ...(promptSnippet === "" ? {} : { promptSnippet }),
    parameters,
    ...(executionMode === "" ? {} : { executionMode }),
    execute,
    renderResult(result, { expanded }, theme, context) {
      const text = result.content
        ?.filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n") ?? "";
      const visible = expanded ? text : (text.split("\n", 1)[0] || "Completed");
      const component = context.lastComponent instanceof CompactText
        ? context.lastComponent
        : new CompactText();
      component.setText(expanded ? visible : theme.fg("muted", visible));
      return component;
    },
  });
}

export function register_rendered(
  api,
  name,
  label,
  description,
  promptSnippet,
  parameters,
  executionMode,
  execute,
  renderer,
) {
  registerTool(api, {
    name,
    label,
    description,
    ...(promptSnippet === "" ? {} : { promptSnippet }),
    parameters,
    ...(executionMode === "" ? {} : { executionMode }),
    execute,
    renderResult(result, { expanded }, theme, context) {
      return renderer(result, expanded === true, theme, context.lastComponent);
    },
  });
}

export function text(value) {
  return { type: "text", text: value };
}

export function image(data, mimeType) {
  return { type: "image", data, mimeType };
}

export function result(content, details, terminate) {
  return { content, details, ...(terminate ? { terminate: true } : {}) };
}

export function text_result(value, details) {
  return { content: [{ type: "text", text: value }], details };
}

export function update(sink, result) {
  if (typeof sink === "function") sink(result);
}

export function is_cancelled(signal) {
  return signal?.aborted === true;
}

export function reject(message) {
  return Promise.reject(new Error(message));
}

export function reject_typed(code, message, details) {
  const error = new Error(`[${code}] ${message}`);
  error.code = code;
  error.details = details;
  return Promise.reject(error);
}
