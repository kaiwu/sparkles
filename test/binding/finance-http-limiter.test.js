import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { ROOT } from "../../scripts/modules.js";

const limiterUrl = pathToFileURL(
  join(
    ROOT,
    "finance",
    "finance_http",
    "src",
    "finance_http",
    "limiter_ffi.mjs",
  ),
).href;

test("provider quota state is shared across independently loaded module copies", async () => {
  const first = await import(`${limiterUrl}?bundle=first`);
  const second = await import(`${limiterUrl}?bundle=second`);
  const scope = `binding:shared:${Date.now()}`;
  const firstCell = first.shared_cell(scope, { remaining: 1 });
  const secondCell = second.shared_cell(scope, { remaining: 99 });

  expect(secondCell).toBe(firstCell);
  first.write_cell(firstCell, { remaining: 0 });
  expect(second.read_cell(secondCell)).toEqual({ remaining: 0 });
});

test("provider scopes and injected cells remain isolated", async () => {
  const limiter = await import(`${limiterUrl}?bundle=isolation`);
  const nonce = Date.now();
  const providerA = limiter.shared_cell(`binding:a:${nonce}`, { remaining: 1 });
  const providerB = limiter.shared_cell(`binding:b:${nonce}`, { remaining: 2 });
  const injectedA = limiter.new_cell({ remaining: 3 });
  const injectedB = limiter.new_cell({ remaining: 4 });

  expect(providerA).not.toBe(providerB);
  expect(injectedA).not.toBe(injectedB);
  limiter.write_cell(providerA, { remaining: 0 });
  expect(limiter.read_cell(providerB)).toEqual({ remaining: 2 });
});
