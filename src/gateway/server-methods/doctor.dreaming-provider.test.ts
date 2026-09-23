import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRuntimeConfig,
  resolveAgentWorkspaceDir,
  resolveMemorySearchConfig,
  getMemorySearchManager,
  loadShortTermPromotionDreamingStats,
  invokeDoctorMemory,
  respondPayload,
  makeDreamingStats,
} from "./doctor.test-support.js";

// Only the dreaming provider lookup is replaced; every other memory-state
// export stays real.
const resolveActiveMemoryDreamingStatus = vi.hoisted(() => vi.fn(async () => null as unknown));
vi.mock("../../plugins/memory-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/memory-state.js")>()),
  resolveActiveMemoryDreamingStatus,
}));

describe("doctor.memory.status with a memory slot owner's dreaming provider", () => {
  beforeEach(() => {
    resolveActiveMemoryDreamingStatus.mockReset().mockResolvedValue(null);
    getRuntimeConfig.mockReset().mockReturnValue({});
    resolveAgentWorkspaceDir.mockReset().mockReturnValue("/tmp/openclaw");
    resolveMemorySearchConfig.mockReset().mockReturnValue({ enabled: true });
    getMemorySearchManager.mockReset();
    loadShortTermPromotionDreamingStats
      .mockReset()
      .mockImplementation(async () => makeDreamingStats());
  });

  it("reports a slot owner's dreaming status even when no search manager exists", async () => {
    getMemorySearchManager.mockResolvedValue({ manager: null, error: "memory search unavailable" });
    resolveActiveMemoryDreamingStatus.mockResolvedValueOnce({
      enabled: true,
      timezone: "Europe/Berlin",
      phases: {
        light: { enabled: true, scheduled: true, cron: "" },
        rem: { enabled: true, scheduled: true, cron: "15 1 * * *", nextRunAtMs: 1_000 },
      },
    });
    const respond = vi.fn();

    await invokeDoctorMemory("doctor.memory.status", respond, { params: {} });

    const payload = respondPayload(respond) as Record<string, unknown>;
    // The search diagnostic stays exactly as before.
    expect(payload.embedding).toEqual({ ok: false, error: "memory search unavailable" });
    const dreaming = payload.dreaming as Record<string, any>;
    expect(dreaming.reportedEnabled).toBe(true);
    expect(dreaming.timezone).toBe("Europe/Berlin");
    expect(dreaming.phases.rem).toMatchObject({
      cron: "15 1 * * *",
      managedCronPresent: true,
      nextRunAtMs: 1_000,
    });
    expect(dreaming.phases.light).toMatchObject({ cron: "", managedCronPresent: true });
    expect(dreaming.shortTermCount).toBe(0);
  });

  it("keeps the configuration toggle apart from the enablement a slot owner reports", async () => {
    getRuntimeConfig.mockReturnValue({
      plugins: {
        slots: { memory: "memory-core" },
        entries: { "memory-core": { config: { dreaming: { enabled: false } } } },
      },
    });
    getMemorySearchManager.mockResolvedValue({ manager: null, error: "memory search unavailable" });
    resolveActiveMemoryDreamingStatus.mockResolvedValueOnce({ enabled: true });
    const respond = vi.fn();

    await invokeDoctorMemory("doctor.memory.status", respond, { params: {} });

    const dreaming = (respondPayload(respond) as Record<string, any>).dreaming;
    // `enabled` is what the page's toggle writes; the report must not mask it.
    expect(dreaming.enabled).toBe(false);
    expect(dreaming.reportedEnabled).toBe(true);
  });

  it("drops the memory-core sweep's next run from phases whose schedule the slot owner reports", async () => {
    getMemorySearchManager.mockResolvedValue({ manager: null, error: "memory search unavailable" });
    resolveActiveMemoryDreamingStatus.mockResolvedValueOnce({
      phases: {
        light: { enabled: true, scheduled: true, cron: "", lastRunAtMs: 500 },
        rem: { enabled: true, scheduled: true, cron: "15 1 * * *", nextRunAtMs: 2_000 },
      },
    });
    const cronList = vi.fn(async () => [
      {
        name: "Memory Dreaming Promotion",
        description: "[managed-by=memory-core.short-term-promotion] test",
        enabled: true,
        payload: {
          kind: "systemEvent",
          text: "__openclaw_memory_core_short_term_promotion_dream__",
        },
        state: { nextRunAtMs: 9_000 },
      },
    ]);
    const respond = vi.fn();

    await invokeDoctorMemory("doctor.memory.status", respond, { params: {}, cronList });

    const phases = (respondPayload(respond) as Record<string, any>).dreaming.phases;
    // Event-driven phase: the sweep's timestamp is not its schedule.
    expect(phases.light).toMatchObject({ cron: "", managedCronPresent: true, lastRunAtMs: 500 });
    expect(phases.light).not.toHaveProperty("nextRunAtMs");
    // A reported next run wins over the sweep's.
    expect(phases.rem).toMatchObject({ cron: "15 1 * * *", nextRunAtMs: 2_000 });
    // A phase the provider does not report keeps the host resolution.
    expect(phases.deep).toMatchObject({ managedCronPresent: true, nextRunAtMs: 9_000 });
  });

  it("keeps the no-manager response unchanged when no dreaming provider reports", async () => {
    getMemorySearchManager.mockResolvedValue({ manager: null, error: "memory search unavailable" });
    const respond = vi.fn();

    await invokeDoctorMemory("doctor.memory.status", respond, { params: {} });

    const payload = respondPayload(respond) as Record<string, unknown>;
    expect(payload.dreaming).toBeUndefined();
  });
});
