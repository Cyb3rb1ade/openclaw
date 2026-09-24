import { describe, expect, it } from "vitest";
import { buildGatewayReloadPlan } from "./config-reload-plan.js";
import { reconcileOrphanedMemoryDreamingJobs } from "./server-cron-memory-dreaming-jobs.js";
import { SYSTEM_JOB_RECONCILERS } from "./server-cron-system-job-reconcilers.js";

describe("memory dreaming reload plan", () => {
  it.each([
    "plugins.slots.memory",
    "plugins.entries.memory-lancedb-namespaced.config.dreaming.enabled",
  ])("reloads plugins and reconciles system jobs when %s changes", (path) => {
    // Turning a third-party slot owner's dreaming off unloads the memory-core
    // sidecar; only the system-job pass can remove its cron job afterwards.
    const plan = buildGatewayReloadPlan([path]);

    expect(plan).toMatchObject({
      restartGateway: false,
      hotReasons: [path],
      reloadPlugins: true,
      reconcileSystemJobs: true,
    });
  });

  it("runs the orphaned dreaming job pass on every cron start and system-job reload", () => {
    expect(SYSTEM_JOB_RECONCILERS).toContain(reconcileOrphanedMemoryDreamingJobs);
  });

  it("keeps other plugin config changes on the plain plugin reload", () => {
    const plan = buildGatewayReloadPlan([
      "plugins.entries.memory-lancedb-namespaced.config.recall",
    ]);

    expect(plan).toMatchObject({ reloadPlugins: true, reconcileSystemJobs: false });
  });
});
