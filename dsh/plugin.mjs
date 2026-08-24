// DeepSeek Harness all-in-one plugin factory for pi-sparkles.
//
// The bundler (scripts/dsh-bundle.js) generates an entry that imports every
// compiled Pi plugin bundle and calls createPlugin with the ordered
// `[shortName, extensionFactory]` list. The resulting Cordis plugin mounts a
// Pi ExtensionApi facade (pi-api.mjs) over the Harness `ctx` and runs every
// extension factory once. Pi session lifecycle hooks follow DSH agent/session
// events; they are never synthesized at process/plugin scope. Registration
// collisions are detected per plugin with the same named-registration guard
// the Pi aggregate uses.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPiApi,
  DSH_CUSTOM_EVENT,
  DSH_STATUS_EVENT,
} from "./pi-api.mjs";

const NAMED_REGISTRATIONS = new Map([
  ["registerTool", (args) => args[0]?.name],
  ["registerCommand", (args) => args[0]],
  ["registerShortcut", (args) => args[0]],
  ["registerFlag", (args) => args[0]],
  ["registerProvider", (args) => args[0]],
  ["registerMessageRenderer", (args) => args[0]],
  ["registerEntryRenderer", (args) => args[0]],
]);

function scopedApi(api, pluginName, registrations) {
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const extractName = NAMED_REGISTRATIONS.get(property);
      if (!extractName) return value.bind(target);
      return (...args) => {
        const name = extractName(args);
        if (typeof name !== "string" || name.trim().length === 0) {
          throw new Error(
            `${pluginName} called ${String(property)} without a stable name`,
          );
        }
        const key = `${String(property)}:${name}`;
        const previous = registrations.get(key);
        if (previous !== undefined) {
          throw new Error(
            `Registration collision for ${String(property)} '${name}': ${previous} and ${pluginName}`,
          );
        }
        registrations.set(key, pluginName);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function agentServiceContext(agent) {
  if (typeof agent.ctx.get !== "function") {
    throw new Error("DSH agent context has no optional service lookup");
  }
  const scoped = {};
  for (const name of ["tools", "commands", "systemPrompt"]) {
    const service = agent.ctx.get(name);
    if (service === undefined) {
      throw new Error(`DSH agent context has no active '${name}' service`);
    }
    scoped[name] = service;
  }
  return scoped;
}

function localDate() {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dshRuntimeGuidance() {
  const tushareDiscovery = process.env?.TUSHARE_TOKEN?.trim()
    ? "The heavily limited Tushare stock-listing identity fallback is configured in this DSH process; never use it first or automatically, and call it only after the primary path is unavailable and the user explicitly requests or accepts the fallback."
    : "The optional Tushare stock-listing identity adapter is unavailable in this DSH process because TUSHARE_TOKEN is not configured; do not call it or guess the missing identity.";
  return `DSH runtime date: ${localDate()}. ${tushareDiscovery} cn_stock_symbol_search covers stock listings only, not benchmark or sector indices. Bound current daily-history requests at this date; never invoke a shell merely to discover today's date, and never request future bars. A daily-history limit caps returned rows, so choose a date window whose expected sessions fit the limit or raise the limit within the tool schema.`;
}

function dshHome() {
  const configured = process.env?.DSH_HOME?.trim();
  if (!configured) return join(homedir(), ".dsh");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  return resolve(configured);
}

async function loadSessionEventTypes() {
  try {
    const hostSession = await import("@deepseek-ai/dsh-session");
    return hostSession.KNOWN_SESSION_EVENT_TYPES;
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  // A development link resolves imports from its source checkout rather than
  // from the profile. DSH maintains this flat fallback specifically so profile
  // plugins can resolve host packages regardless of their own install layout.
  const fallback = join(
    dshHome(),
    "profiles",
    "node_modules",
    "@deepseek-ai",
    "dsh-session",
    "lib",
    "index.js",
  );
  const hostSession = await import(pathToFileURL(fallback).href);
  return hostSession.KNOWN_SESSION_EVENT_TYPES;
}

function registerSessionEventTypes(knownSessionEventTypes) {
  if (
    !(knownSessionEventTypes instanceof Set) ||
    typeof knownSessionEventTypes.add !== "function"
  ) {
    throw new Error("DSH session event vocabulary is unavailable");
  }
  // DSH exports the process-wide vocabulary as a ReadonlySet but has no
  // registration service for npm plugins. The bundle pins the tested host version
  // and contributes its two required event types before any cold session can
  // load. Vocabulary knowledge is process-lifetime state, like DSH's compiled
  // catalog, so it deliberately outlives plugin fibers and HMR disposal.
  knownSessionEventTypes.add(DSH_CUSTOM_EVENT);
  knownSessionEventTypes.add(DSH_STATUS_EVENT);
}

/**
 * Build the Cordis plugin object.
 * @param {Array<[string, (api: object) => Promise<void>]>} extensions
 *   ordered `[pluginShortName, extensionFactory]` entries.
 * @param {Array<[string, object|Function]>|string} dshExtensionsOrName
 *   DSH-native Cordis plugins, or the plugin name for the legacy two-argument form.
 * @param {string} pluginName - Cordis plugin name.
 * @param {Array<[string, Function, object?]>} scopedExtensions
 *   Pi shells that must be instantiated once per DSH agent rather than once
 *   per host process. The optional metadata can contribute one shared prompt.
 * @param {Set<string>|undefined} knownSessionEventTypes - optional injected
 *   DSH persisted-event vocabulary for deterministic tests.
 * @returns the Cordis plugin `{ name, inject, apply }`.
 */
export function createPlugin(
  extensions,
  dshExtensionsOrName = [],
  pluginName = "dsh-sparkles",
  scopedExtensions = [],
  knownSessionEventTypes,
) {
  const dshExtensions = Array.isArray(dshExtensionsOrName)
    ? dshExtensionsOrName
    : [];
  const resolvedPluginName =
    typeof dshExtensionsOrName === "string"
      ? dshExtensionsOrName
      : pluginName;
  const debug = typeof process !== "undefined" && process.env?.DSH_PI_SPARKLES_DEBUG === "1";
  const trace = (...args) => {
    if (debug) console.error("[dsh-sparkles]", ...args);
  };
  return {
    name: resolvedPluginName,
    inject: ["tools", "commands", "agents", "systemPrompt"],
    async apply(ctx, config) {
      registerSessionEventTypes(
        knownSessionEventTypes ?? await loadSessionEventTypes(),
      );
      const registrations = new Map();
      const api = createPiApi({ ctx, config: config ?? {} });
      for (const [shortName, extension] of extensions) {
        if (typeof extension !== "function") {
          throw new Error(`${shortName} has no extension factory`);
        }
        trace(`loading ${shortName}`);
        await extension(scopedApi(api, shortName, registrations));
      }
      for (const [shortName, extension] of dshExtensions) {
        if (
          typeof extension !== "function" &&
          (typeof extension !== "object" || extension === null)
        ) {
          throw new Error(`${shortName} has no DSH Cordis plugin export`);
        }
        trace(`loading DSH-native ${shortName}`);
        const dshConfig = config?.dsh;
        const extensionConfig =
          typeof dshConfig === "object" &&
          dshConfig !== null &&
          Object.hasOwn(dshConfig, shortName)
            ? dshConfig[shortName]
            : {};
        await ctx.plugin(extension, extensionConfig);
      }
      const scopedApis = new Map();
      ctx.on("agent/created", ({ agent }) => {
        if (!agent?.ctx) {
          throw new Error("DSH agent has no scoped Cordis context");
        }
        if (scopedApis.has(agent)) {
          throw new Error(`DSH agent '${String(agent.id)}' was already composed`);
        }
        // Direct agent.ctx service properties are guarded by the creating
        // fiber's inject list. Optional lookup returns the same services traced
        // to agent.ctx, so registrations stay agent-owned without requiring
        // that unrelated fiber to inject Sparkles' dependencies.
        const scopedCtx = agentServiceContext(agent);
        const scopedRegistrations = new Map(registrations);
        const scopedApi = createPiApi({
          ctx: scopedCtx,
          config: config ?? {},
          activeTools: () => api._registeredToolNames(),
          scopedState: true,
        });
        scopedApis.set(agent, scopedApi);
        let expectedBeforeAgentStart = 0;
        try {
          for (const [shortName, extension, metadata = {}] of scopedExtensions) {
            if (typeof extension !== "function") {
              throw new Error(`${shortName} has no scoped extension factory`);
            }
            trace(`loading scoped ${shortName} for ${String(agent.id)}`);
            const loaded = extension(
              scopedApiForAgent(
                scopedApi,
                shortName,
                scopedRegistrations,
              ),
            );
            Promise.resolve(loaded).catch((error) => {
              ctx.logger?.warn?.(
                `[dsh-sparkles] scoped ${shortName} initialization failed: ${String(error)}`,
              );
            });
            if (typeof metadata.systemPrompt === "string") {
              expectedBeforeAgentStart += 1;
              scopedCtx.systemPrompt.section({
                name: metadata.promptName ?? `pi-sparkles:${shortName}`,
                order: metadata.promptOrder ?? 99,
                text: `${metadata.systemPrompt}\n${dshRuntimeGuidance()}`,
              });
            }
          }
          const eventCounts = scopedApi._scopedEventCounts();
          if (eventCounts.beforeAgentStart !== expectedBeforeAgentStart) {
            throw new Error(
              `Scoped Pi before_agent_start handlers (${eventCounts.beforeAgentStart}) do not match DSH prompt contributions (${expectedBeforeAgentStart})`,
            );
          }
        } catch (error) {
          scopedApis.delete(agent);
          trace(`scoped composition failed for ${String(agent.id)}:`, error);
          throw new Error(
            `DSH scoped plugins failed for agent '${String(agent.id)}'`,
            { cause: error },
          );
        }
      });
      ctx.on("agent/session-start", async ({ agent, source }) => {
        const reason = source === "resume" ? "resume" : "startup";
        await api._fireSessionStart(agent, reason);
        await scopedApis.get(agent)?._fireSessionStart(agent, reason);
      });
      ctx.on("agent/disposed", async ({ agent }) => {
        const scoped = scopedApis.get(agent);
        await scoped?._fireSessionShutdown(agent, "quit");
        scopedApis.delete(agent);
        await api._fireSessionShutdown(agent, "quit");
      });
      trace(
        `registered ${registrations.size} global named registrations from ${extensions.length} Pi extensions, ${scopedExtensions.length} scoped Pi counterparts, and ${dshExtensions.length} DSH-native extensions`,
      );
    },
  };
}

function scopedApiForAgent(api, pluginName, registrations) {
  return scopedApi(api, `scoped:${pluginName}`, registrations);
}
