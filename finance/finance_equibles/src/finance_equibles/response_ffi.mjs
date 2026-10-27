const numberKey = "__finance_equibles_number__";

export function normalize_numbers(source) {
  try {
    let supportsSource = false;
    JSON.parse("0", (_key, value, context) => {
      supportsSource = context?.source === "0";
      return value;
    });
    if (!supportsSource) return "";
    return JSON.stringify(
      JSON.parse(source, (_key, value, context) => {
        // Revivers do not revisit the wrappers returned for numeric tokens.
        // An object seen here with this key therefore came from the wire.
        if (value !== null && typeof value === "object" && Object.hasOwn(value, numberKey)) {
          throw new Error("Reserved numeric-token marker in provider JSON");
        }
        return typeof value === "number" ? { [numberKey]: context.source } : value;
      }),
    );
  } catch {
    return "";
  }
}
