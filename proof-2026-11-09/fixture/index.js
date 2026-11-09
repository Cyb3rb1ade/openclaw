// FIXTURE for openclaw/openclaw#155860 proof. Not a real memory plugin.
// Holds the memory slot and answers dreaming.getStatus with clearly fake data.
// The report is chosen per call from a scenario file so scenarios can switch
// without a restart; the runtime kind (search runtime vs provider runtime) is
// fixed at registration from plugin config.runtimeMode.
import { readFileSync } from "node:fs";

const FIXTURE_LABEL = "FIXTURE (fake data, PR #155860 proof)";

function readScenario(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { report: "none" };
  }
}

function nextUtc(hour, minute) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

function buildReport(kind) {
  const rem = { enabled: true, scheduled: true, cron: "15 1 * * *", nextRunAtMs: nextUtc(0, 15) };
  const deep = { enabled: true, scheduled: true, cron: "0 4 * * *", nextRunAtMs: nextUtc(3, 0) };
  // Event-driven light phase: no timer, so cron "" (see the PR contract).
  const light = { enabled: true, scheduled: true, cron: "", lastRunAtMs: Date.now() - 42 * 60_000 };
  const stats = {
    shortTermCount: 9,
    promotedTotal: 139,
    promotedToday: 4,
    lastPromotedAt: new Date(nextUtc(3, 0) - 86_400_000 + 7 * 60_000).toISOString(),
  };
  switch (kind) {
    case "full":
      return { enabled: true, timezone: "Europe/Berlin", phases: { light, deep, rem }, stats };
    case "throw":
      throw new Error("fixture: simulated provider failure");
    case "none":
    default:
      return null;
  }
}

const plugin = {
  id: "acme-memory-fixture",
  name: "ACME Memory (fixture)",
  register(api) {
    const cfg = api.pluginConfig || {};
    const scenarioFile = cfg.scenarioFile;
    const workspaceDir = cfg.workspaceDir;
    const dreaming = {
      async getStatus({ agentId }) {
        const scenario = readScenario(scenarioFile);
        api.logger?.info?.(`${FIXTURE_LABEL}: getStatus agent=${agentId} report=${scenario.report}`);
        return buildReport(scenario.report);
      },
    };
    if (cfg.runtimeMode === "provider-runtime") {
      api.registerMemoryCapability({
        providerRuntime: {
          async open() {
            return {
              provider: {
                capabilities: { sources: ["memory"], pagination: false, candidates: [], projectFilter: false },
                async search() { return { results: [] }; },
                async get() { return { found: false }; },
                async health() {
                  return { status: "ready", message: `${FIXTURE_LABEL}: provider runtime health` };
                },
                async close() {},
              },
            };
          },
          async closeMemorySearchManager() {},
          async closeAllMemorySearchManagers() {},
        },
        dreaming,
      });
      return;
    }
    const manager = {
      async search() { return []; },
      async readFile() { throw new Error("fixture has no files"); },
      status() {
        return { backend: "builtin", provider: "acme-fixture", model: "fixture-embed", workspaceDir, dirty: false, sources: ["memory"], files: 0, chunks: 0 };
      },
      getCachedEmbeddingAvailability() { return { ok: true, checked: true, cached: true }; },
      async probeEmbeddingAvailability() { return { ok: true, checked: true }; },
      async probeVectorAvailability() { return true; },
      async probeVectorStoreAvailability() { return true; },
      async close() {},
    };
    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager({ purpose = "default" } = {}) {
          return { manager, debug: { backend: "builtin", purpose, managerMs: 0 } };
        },
        resolveMemoryBackendConfig() { return { backend: "builtin" }; },
        async authorizeSearchHits({ hits } = {}) { return (hits || []).filter((h) => h?.source !== "sessions"); },
      },
      dreaming,
    });
  },
};

export default plugin;
