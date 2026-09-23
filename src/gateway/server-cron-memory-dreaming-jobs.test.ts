import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronJob } from "../cron/types.js";
import {
  isMemoryCoreDreamingOrphaned,
  reconcileOrphanedMemoryDreamingJobs,
} from "./server-cron-memory-dreaming-jobs.js";

function job(overrides: Partial<CronJob> & { id: string }): CronJob {
  return {
    name: "unrelated",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: "cron", expr: "15 1 * * *", tz: "Europe/Berlin" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "hello" },
    state: {},
    ...overrides,
  } as CronJob;
}

const managedPromotion = job({
  id: "promotion",
  declarationKey: "memory-core:memory-dreaming-promotion",
  name: "Memory Dreaming Promotion",
  description: "[managed-by=memory-core.short-term-promotion] Promote weighted short-term recalls",
  payload: { kind: "agentTurn", message: "__openclaw_memory_core_short_term_promotion_dream__" },
});
// Pre-declaration-key job identified by name + tag only.
const legacyPromotion = job({
  id: "legacy-promotion",
  name: "Memory Dreaming Promotion",
  description: "[managed-by=memory-core.short-term-promotion] older build",
});
const legacyLightPhase = job({
  id: "legacy-light",
  name: "Memory Light Dreaming",
  payload: { kind: "systemEvent", text: "__openclaw_memory_core_light_sleep__" },
});
const pluginOwnJob = job({ id: "plugin-rem", name: "PLUR1BUS rem-dream (main)" });
// Same display name as memory-core's job, but not memory-core's.
const lookalike = job({ id: "lookalike", name: "Memory Dreaming Promotion", description: "mine" });

function thirdPartyOwner(dreamingEnabled: boolean | undefined): OpenClawConfig {
  return {
    plugins: {
      slots: { memory: "memory-lancedb-namespaced" },
      entries: {
        "memory-lancedb-namespaced": {
          config: dreamingEnabled === undefined ? {} : { dreaming: { enabled: dreamingEnabled } },
        },
      },
    },
  } as OpenClawConfig;
}

function fakeCron(jobs: CronJob[]) {
  const store = new Map(jobs.map((entry) => [entry.id, entry]));
  return {
    store,
    list: vi.fn(async () => [...store.values()]),
    remove: vi.fn(async (id: string) => ({ ok: true as const, removed: store.delete(id) })),
  };
}

const logger = { warn: vi.fn(), info: vi.fn() };

describe("isMemoryCoreDreamingOrphaned", () => {
  it("is orphaned only while a third-party slot owner has dreaming turned off", () => {
    expect(isMemoryCoreDreamingOrphaned(thirdPartyOwner(false))).toBe(true);
    // The loader activates memory-core as sidecar here; it reconciles its own jobs.
    expect(isMemoryCoreDreamingOrphaned(thirdPartyOwner(true))).toBe(false);
    // Dreaming defaults to enabled, so an unset flag also keeps the sidecar.
    expect(isMemoryCoreDreamingOrphaned(thirdPartyOwner(undefined))).toBe(false);
  });

  it("leaves memory-core alone when it owns the memory slot", () => {
    expect(isMemoryCoreDreamingOrphaned({} as OpenClawConfig)).toBe(false);
    expect(
      isMemoryCoreDreamingOrphaned({
        plugins: {
          slots: { memory: "memory-core" },
          entries: { "memory-core": { config: { dreaming: { enabled: false } } } },
        },
      } as OpenClawConfig),
    ).toBe(false);
  });
});

describe("reconcileOrphanedMemoryDreamingJobs", () => {
  it("removes memory-core's dreaming jobs once the sidecar is unloaded", async () => {
    const cron = fakeCron([
      managedPromotion,
      legacyPromotion,
      legacyLightPhase,
      pluginOwnJob,
      lookalike,
    ]);

    const result = await reconcileOrphanedMemoryDreamingJobs({
      cron: cron as never,
      cfg: thirdPartyOwner(false),
      logger,
    });

    expect(result).toEqual({ ok: true });
    expect([...cron.store.keys()].toSorted()).toEqual(["lookalike", "plugin-rem"]);
    expect(cron.list).toHaveBeenCalledWith({ includeDisabled: true });
  });

  it("does not touch the job while memory-core runs as sidecar and owns it", async () => {
    const cron = fakeCron([managedPromotion]);

    await reconcileOrphanedMemoryDreamingJobs({
      cron: cron as never,
      cfg: thirdPartyOwner(true),
      logger,
    });

    expect(cron.list).not.toHaveBeenCalled();
    expect(cron.store.has("promotion")).toBe(true);
  });

  it("reports an unconverged pass so the gateway retries", async () => {
    const listFails = fakeCron([managedPromotion]);
    listFails.list.mockRejectedValueOnce(new Error("store busy"));
    await expect(
      reconcileOrphanedMemoryDreamingJobs({
        cron: listFails as never,
        cfg: thirdPartyOwner(false),
        logger,
      }),
    ).resolves.toEqual({ ok: false });

    const removeFails = fakeCron([managedPromotion, legacyLightPhase]);
    removeFails.remove.mockRejectedValueOnce(new Error("locked"));
    await expect(
      reconcileOrphanedMemoryDreamingJobs({
        cron: removeFails as never,
        cfg: thirdPartyOwner(false),
        logger,
      }),
    ).resolves.toEqual({ ok: false });
    // One failure does not stop the rest of the family from being removed.
    expect(removeFails.remove).toHaveBeenCalledTimes(2);
  });

  it("stops at a superseded config via the commit guard", async () => {
    const cron = fakeCron([managedPromotion]);
    const superseded = new Error("superseded");
    const commitGuard = vi.fn(() => {
      throw superseded;
    });

    await expect(
      reconcileOrphanedMemoryDreamingJobs({
        cron: cron as never,
        cfg: thirdPartyOwner(false),
        logger,
        commitGuard,
      }),
    ).rejects.toBe(superseded);
    expect(cron.remove).not.toHaveBeenCalled();
  });
});
