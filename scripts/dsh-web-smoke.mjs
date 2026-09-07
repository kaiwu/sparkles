// Boot only a disposable installation profile; never touch the user's server.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";

export async function verifyInstalledDshWeb(dshCommand, profile) {
  assert.match(process.env.DSH_HOME ?? "", /\/dsh-sparkles-smoke-home-[^/]+$/);
  const cli = realpathSync(execFileSync("which", [dshCommand], { encoding: "utf8" }).trim());
  const webApp = join(dirname(dirname(cli)), "node_modules", "@deepseek-ai", "dsh-web-app");
  execFileSync(dshCommand, ["plugin", "--profile", profile, "add", webApp], {
    stdio: "pipe", timeout: 30_000,
  });
  const child = spawn(dshCommand, [
    "--profile", profile, "--host", "127.0.0.1", "--port", "0", "--no-open",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let startupError;
  child.on("error", (error) => { startupError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { output = (output + chunk).slice(-128_000); });
  }
  try {
    const deadline = Date.now() + 30_000;
    let launchUrl;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      assert.equal(child.exitCode, null, "installed DSH web exited before readiness");
      // Keep the disposable server's launch credential in memory only.
      launchUrl = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)/)?.[1];
      if (launchUrl) break;
      await delay(100);
    }
    assert.ok(launchUrl, "installed DSH web did not announce readiness within 30 seconds");
    const origin = new URL(launchUrl).origin;
    const exchange = await fetch(launchUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    assert.equal(exchange.status, 303, "DSH launch-token exchange failed");
    const cookie = exchange.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie, "DSH launch-token exchange omitted its session cookie");
    const headers = { cookie };
    const response = await fetch(origin, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const html = await response.text();
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]).find((source) => source.includes("__DSH_BOOT__"));
    assert.ok(script, "installed DSH page has no client boot graph");
    const sandbox = {};
    sandbox.window = sandbox;
    runInNewContext(script, sandbox, { timeout: 1000 });
    const row = sandbox.window.__DSH_BOOT__?.entries?.find(
      (entry) => entry.id === "@dsh-sparkles/dsh-sparkles",
    );
    assert.ok(row, "installed DSH boot graph omitted Sparkles client");
    const entryIds = new Set(sandbox.window.__DSH_BOOT__.entries.map((entry) => entry.id));
    for (const dependency of row.inject ?? []) {
      assert.ok(entryIds.has(dependency), `Sparkles client dependency is missing: ${dependency}`);
    }
    const assetUrl = new URL(row.url, origin);
    assert.equal(assetUrl.origin, origin);
    const asset = await fetch(assetUrl, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(asset.status, 200);
    const source = await asset.text();
    for (const marker of ["window.__ModuleLoader__.load", "shell.overlay", "tool.call.toolview"]) {
      assert.ok(source.includes(marker), `served Sparkles client omitted ${marker}`);
    }
    return { clientDiscovery: true, servedAssets: true, visualQA: false };
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      try { await stopped; } finally { clearTimeout(force); }
    }
  }
}
