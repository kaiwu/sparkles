import { describe, expect, test } from "bun:test";
import {
  piDurableDependencies,
  TESTED_PI_HOST_VERSION,
} from "../../scripts/pi-durable-dependencies.js";

describe("Pi release SDK alignment", () => {
  test("all bundled SDK pins belong to the tested host release", () => {
    expect(Object.values(piDurableDependencies())).toEqual([
      TESTED_PI_HOST_VERSION,
      TESTED_PI_HOST_VERSION,
      TESTED_PI_HOST_VERSION,
    ]);
  });

  test("rejects a stale SDK pin even when the others match", () => {
    for (const name of Object.keys(piDurableDependencies())) {
      expect(() => piDurableDependencies({
        dependencies: { ...piDurableDependencies(), [name]: "1.0.2" },
      })).toThrow(`${name} must match the tested Pi release`);
    }
  });

  test("rejects floating SDK versions", () => {
    expect(() => piDurableDependencies({
      dependencies: {
        ...piDurableDependencies(),
        "@earendil-works/pi-durable": `^${TESTED_PI_HOST_VERSION}`,
      },
    })).toThrow("requires an exact runtime version");
  });
});
