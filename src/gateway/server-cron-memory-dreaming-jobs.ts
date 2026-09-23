// Removes memory-core's managed dreaming cron jobs while memory-core is not loaded to own them.
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronJob } from "../cron/types.js";
import {
  DEFAULT_MEMORY_DREAMING_PLUGIN_ID,
  LEGACY_MEMORY_LIGHT_DREAMING_CRON_NAME,
  LEGACY_MEMORY_LIGHT_DREAMING_CRON_TAG,
  LEGACY_MEMORY_LIGHT_DREAMING_EVENT_TEXT,
  LEGACY_MEMORY_REM_DREAMING_CRON_NAME,
  LEGACY_MEMORY_REM_DREAMING_CRON_TAG,
  LEGACY_MEMORY_REM_DREAMING_EVENT_TEXT,
  MANAGED_MEMORY_DREAMING_CRON_DECLARATION_KEY,
  MANAGED_MEMORY_DREAMING_CRON_NAME,
  MANAGED_MEMORY_DREAMING_CRON_TAG,
  MEMORY_DREAMING_SYSTEM_EVENT_TEXT,
  resolveMemoryDreamingSidecarPluginId,
} from "../memory-host-sdk/dreaming.js";
import type { GatewayCronServiceContract } from "./server-cron-contract.js";

type MemoryDreamingJobCron = Pick<GatewayCronServiceContract, "list" | "remove">;

function payloadToken(job: CronJob): string | undefined {
  const payload = job.payload;
  if (payload?.kind === "systemEvent") {
    return normalizeOptionalString(payload.text);
  }
  if (payload?.kind === "agentTurn") {
    return normalizeOptionalString(payload.message);
  }
  return undefined;
}

// Mirrors memory-core's own job family (extensions/memory-core/src/dreaming-cron.ts),
// including the legacy per-phase jobs its disabled branch removes as well.
function isMemoryCoreDreamingJob(job: CronJob): boolean {
  if (
    normalizeOptionalString(job.declarationKey) === MANAGED_MEMORY_DREAMING_CRON_DECLARATION_KEY
  ) {
    return true;
  }
  const name = normalizeOptionalString(job.name);
  const description = normalizeOptionalString(job.description);
  const token = payloadToken(job);
  if (name === MANAGED_MEMORY_DREAMING_CRON_NAME) {
    return (
      description?.includes(MANAGED_MEMORY_DREAMING_CRON_TAG) === true ||
      token === MEMORY_DREAMING_SYSTEM_EVENT_TEXT
    );
  }
  if (
    description?.includes(LEGACY_MEMORY_LIGHT_DREAMING_CRON_TAG) ||
    description?.includes(LEGACY_MEMORY_REM_DREAMING_CRON_TAG)
  ) {
    return true;
  }
  return (
    (name === LEGACY_MEMORY_LIGHT_DREAMING_CRON_NAME &&
      token === LEGACY_MEMORY_LIGHT_DREAMING_EVENT_TEXT) ||
    (name === LEGACY_MEMORY_REM_DREAMING_CRON_NAME &&
      token === LEGACY_MEMORY_REM_DREAMING_EVENT_TEXT)
  );
}

/**
 * Whether memory-core's dreaming jobs are orphaned: another plugin owns the
 * memory slot and the dreaming sidecar is not due, so the loader does not load
 * memory-core and its own disabled-branch cleanup can never run.
 */
function isMemoryCoreDreamingOrphaned(cfg: OpenClawConfig): boolean {
  const memorySlot = normalizeOptionalString(cfg.plugins?.slots?.memory);
  const normalizedSlot = normalizeLowercaseStringOrEmpty(memorySlot);
  if (!normalizedSlot || normalizedSlot === DEFAULT_MEMORY_DREAMING_PLUGIN_ID) {
    // memory-core owns the slot and reconciles its own jobs.
    return false;
  }
  return resolveMemoryDreamingSidecarPluginId({ cfg, memorySlot }) === null;
}

/**
 * Removes memory-core's managed dreaming cron jobs once memory-core stops being
 * loaded as the dreaming sidecar. Turning `dreaming.enabled` off on a
 * third-party slot owner unloads memory-core, and dispose only clears timers, so
 * without this pass its promotion job keeps running beside the slot owner.
 */
export async function reconcileOrphanedMemoryDreamingJobs(params: {
  cron: MemoryDreamingJobCron;
  cfg: OpenClawConfig;
  logger: {
    warn: (obj: unknown, msg?: string) => void;
    info?: (obj: unknown, msg?: string) => void;
  };
  commitGuard?: () => void;
}): Promise<{ ok: boolean }> {
  if (!isMemoryCoreDreamingOrphaned(params.cfg)) {
    return { ok: true };
  }
  let jobs: CronJob[];
  try {
    jobs = await params.cron.list({ includeDisabled: true });
  } catch (error) {
    params.logger.warn({ err: String(error) }, "cron-memory-dreaming: job inventory failed");
    return { ok: false };
  }
  params.commitGuard?.();
  let ok = true;
  let removed = 0;
  for (const job of jobs.filter(isMemoryCoreDreamingJob)) {
    await yieldToEventLoop();
    params.commitGuard?.();
    try {
      const result = await params.cron.remove(
        job.id,
        params.commitGuard ? { commitGuard: params.commitGuard } : undefined,
      );
      if (result.removed) {
        removed += 1;
      }
    } catch (error) {
      params.commitGuard?.();
      ok = false;
      params.logger.warn(
        { jobId: job.id, err: String(error) },
        "cron-memory-dreaming: orphaned memory-core dreaming job cleanup failed",
      );
    }
  }
  if (removed > 0) {
    params.logger.info?.(
      { removed },
      "cron-memory-dreaming: removed memory-core dreaming job(s) left behind by its unloaded sidecar",
    );
  }
  return { ok };
}
