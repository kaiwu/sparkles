// Bundled-provider fixtures share the production quota interpreter. Give each
// fixture an isolated quota registry and a clock that advances past its next
// permit, so exact acquisition tests neither sleep nor retain another test's
// wall-clock state. Provider pacing itself is covered by its conformance laws.
const registryKey = Symbol.for("pi-sparkles.finance-http.limiters.v1");

export function scriptedProviderClock(startUnixMilliseconds = Date.now()) {
  const originalNow = Date.now;
  const originalRegistry = globalThis[registryKey];
  let now = startUnixMilliseconds;
  globalThis[registryKey] = new Map();
  Date.now = () => {
    now += 2000;
    return now;
  };
  return () => {
    Date.now = originalNow;
    if (originalRegistry === undefined) delete globalThis[registryKey];
    else globalThis[registryKey] = originalRegistry;
  };
}
