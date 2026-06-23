// SQLite persistence for batch audio diarization jobs and result cache.
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveConfigDir } from "../../utils.js";
import type {
  AudioDiarizationCacheEntry,
  AudioDiarizationJob,
  AudioDiarizationJobState,
  AudioDiarizationMergeResult,
  DiarizationTargetRef,
  SpeakerSegmentWord,
} from "./types.js";

const DB_FILE_NAME = "audio-diarization.db";
const AUDIO_CACHE_DIR = "audio";

function resolveDbPath(): string {
  const configDir = resolveConfigDir();
  return path.join(configDir, "cache", DB_FILE_NAME);
}

function resolveCacheDir(): string {
  const configDir = resolveConfigDir();
  return path.join(configDir, "cache", "audio-diarization");
}

function resolveAudioPath(audioHash: string): string {
  return path.join(resolveCacheDir(), AUDIO_CACHE_DIR, audioHash);
}

async function ensureDbDir(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}

let sharedDb: DatabaseSync | null = null;

export async function getDiarizationDb(): Promise<DatabaseSync> {
  if (sharedDb) {
    return sharedDb;
  }
  const dbPath = resolveDbPath();
  await ensureDbDir(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      audioHash TEXT NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      configVersion TEXT NOT NULL,
      state TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      resultJson TEXT,
      mergedResultJson TEXT,
      asrText TEXT,
      asrWordsJson TEXT,
      targetRefJson TEXT,
      errorMessage TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_lookup
      ON jobs(audioHash, provider, model, configVersion);

    CREATE TABLE IF NOT EXISTS cache (
      audioHash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      configVersion TEXT NOT NULL,
      resultJson TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (audioHash, provider, model, configVersion)
    );

    CREATE TABLE IF NOT EXISTS merge_results (
      audioHash TEXT NOT NULL,
      diarizationProvider TEXT NOT NULL,
      diarizationModel TEXT,
      diarizationConfigVersion TEXT NOT NULL,
      asrModel TEXT,
      asrTextHash TEXT NOT NULL,
      asrWordsHash TEXT NOT NULL,
      mergeConfigVersion TEXT NOT NULL,
      mediaOutputId TEXT NOT NULL,
      resultJson TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (audioHash, diarizationProvider, diarizationModel, diarizationConfigVersion, asrModel, asrTextHash, asrWordsHash, mergeConfigVersion)
    );

    CREATE INDEX IF NOT EXISTS idx_merge_results_media_output_id
      ON merge_results(mediaOutputId);

    CREATE TABLE IF NOT EXISTS speaker_mappings (
      agentId TEXT NOT NULL,
      speakerLabel TEXT NOT NULL,
      speakerDisplayName TEXT NOT NULL,
      attributionSource TEXT NOT NULL,
      confidence REAL,
      confirmed INTEGER NOT NULL,
      proposedAt INTEGER NOT NULL,
      confirmedAt INTEGER,
      contextHint TEXT,
      PRIMARY KEY (agentId, speakerLabel)
    );

    CREATE INDEX IF NOT EXISTS idx_speaker_mappings_agent
      ON speaker_mappings(agentId);
  `);
  sharedDb = db;
  return db;
}

export function resetDiarizationDbForTests(): void {
  if (sharedDb) {
    try {
      sharedDb.close();
    } catch {
      // ignore
    }
    sharedDb = null;
  }
}

function serializeResult(result: unknown): string {
  return JSON.stringify(result);
}

function parseResult<T>(json: string | null): T | null {
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function createDiarizationJob(job: AudioDiarizationJob): Promise<AudioDiarizationJob> {
  const db = await getDiarizationDb();
  const insert = db.prepare(`
    INSERT INTO jobs (
      id, audioHash, source, provider, model, configVersion, state,
      createdAt, updatedAt, resultJson, mergedResultJson, asrText, asrWordsJson,
      targetRefJson, errorMessage
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    job.id,
    job.audioHash,
    job.source,
    job.provider,
    normalizeModelForStorage(job.model),
    job.configVersion,
    job.state,
    job.createdAt,
    job.updatedAt,
    job.result ? serializeResult(job.result) : null,
    job.mergedResult ? serializeResult(job.mergedResult) : null,
    job.asrText,
    job.asrWords ? serializeResult(job.asrWords) : null,
    serializeResult(job.targetRef),
    job.errorMessage,
  );
  return job;
}

export async function getDiarizationJobById(id: string): Promise<AudioDiarizationJob | null> {
  const db = await getDiarizationDb();
  const select = db.prepare("SELECT * FROM jobs WHERE id = ?");
  const row = select.get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return rowToJob(row);
}

export async function findDiarizationJob(
  audioHash: string,
  provider: string,
  model: string | null,
  configVersion: string,
): Promise<AudioDiarizationJob | null> {
  const db = await getDiarizationDb();
  const select = db.prepare(`
    SELECT * FROM jobs
    WHERE audioHash = ? AND provider = ? AND model = ? AND configVersion = ?
    ORDER BY createdAt DESC
    LIMIT 1
  `);
  const row = select.get(audioHash, provider, normalizeModelForStorage(model), configVersion) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  return rowToJob(row);
}

export async function updateDiarizationJobState(
  id: string,
  state: AudioDiarizationJobState,
  options: { result?: unknown; mergedResult?: unknown; errorMessage?: string } = {},
): Promise<void> {
  const db = await getDiarizationDb();
  const update = db.prepare(`
    UPDATE jobs
    SET state = ?, updatedAt = ?, resultJson = ?, mergedResultJson = ?, errorMessage = ?
    WHERE id = ?
  `);
  update.run(
    state,
    Date.now(),
    options.result ? serializeResult(options.result) : null,
    options.mergedResult ? serializeResult(options.mergedResult) : null,
    options.errorMessage ?? null,
    id,
  );
}

export async function getQueuedDiarizationJobs(limit: number): Promise<AudioDiarizationJob[]> {
  const db = await getDiarizationDb();
  const select = db.prepare(`
    SELECT * FROM jobs
    WHERE state = 'queued'
    ORDER BY createdAt ASC
    LIMIT ?
  `);
  const rows = select.all(limit) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

function normalizeModelForStorage(model: string | null | undefined): string {
  return model ?? "";
}

function normalizeModelFromStorage(model: unknown): string | null {
  if (model === null || model === undefined || model === "") {
    return null;
  }
  return String(model);
}

function rowToJob(row: Record<string, unknown>): AudioDiarizationJob {
  return {
    id: String(row.id),
    audioHash: String(row.audioHash),
    source: String(row.source),
    provider: String(row.provider),
    model: normalizeModelFromStorage(row.model),
    configVersion: String(row.configVersion),
    state: String(row.state) as AudioDiarizationJobState,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    result: parseResult(row.resultJson as string),
    mergedResult: parseResult(row.mergedResultJson as string),
    asrText: row.asrText ? String(row.asrText) : null,
    asrWords: parseResult(row.asrWordsJson as string),
    targetRef: parseResult(row.targetRefJson as string) as DiarizationTargetRef,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
  };
}

export async function getDiarizationCacheEntry(
  audioHash: string,
  provider: string,
  model: string | null,
  configVersion: string,
): Promise<AudioDiarizationCacheEntry | null> {
  const db = await getDiarizationDb();
  const select = db.prepare(`
    SELECT * FROM cache
    WHERE audioHash = ? AND provider = ? AND model = ? AND configVersion = ?
  `);
  const row = select.get(audioHash, provider, normalizeModelForStorage(model), configVersion) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  return {
    audioHash: String(row.audioHash),
    provider: String(row.provider),
    model: row.model ? String(row.model) : null,
    configVersion: String(row.configVersion),
    result: parseResult(row.resultJson as string) ?? [],
    createdAt: Number(row.createdAt),
  };
}

export async function setDiarizationCacheEntry(entry: AudioDiarizationCacheEntry): Promise<void> {
  const db = await getDiarizationDb();
  const upsert = db.prepare(`
    INSERT INTO cache (audioHash, provider, model, configVersion, resultJson, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(audioHash, provider, model, configVersion)
    DO UPDATE SET resultJson = excluded.resultJson, createdAt = excluded.createdAt
  `);
  upsert.run(
    entry.audioHash,
    entry.provider,
    normalizeModelForStorage(entry.model),
    entry.configVersion,
    serializeResult(entry.result),
    entry.createdAt,
  );
}

export async function storeDiarizationAudio(audioHash: string, buffer: Buffer): Promise<string> {
  const audioPath = resolveAudioPath(audioHash);
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await fs.writeFile(audioPath, buffer);
  return audioPath;
}

export async function getDiarizationAudio(audioHash: string): Promise<Buffer | null> {
  const audioPath = resolveAudioPath(audioHash);
  try {
    return await fs.readFile(audioPath);
  } catch {
    return null;
  }
}

export async function getDiarizationMergeResult(
  audioHash: string,
  diarizationProvider: string,
  diarizationModel: string | null,
  diarizationConfigVersion: string,
  asrModel: string | null,
  asrTextHash: string,
  asrWordsHash: string,
  mergeConfigVersion: string,
): Promise<AudioDiarizationMergeResult | null> {
  const db = await getDiarizationDb();
  const select = db.prepare(`
    SELECT * FROM merge_results
    WHERE audioHash = ? AND diarizationProvider = ? AND diarizationModel = ?
      AND diarizationConfigVersion = ? AND asrModel = ? AND asrTextHash = ?
      AND asrWordsHash = ? AND mergeConfigVersion = ?
  `);
  const row = select.get(
    audioHash,
    diarizationProvider,
    normalizeModelForStorage(diarizationModel),
    diarizationConfigVersion,
    normalizeModelForStorage(asrModel),
    asrTextHash,
    asrWordsHash,
    mergeConfigVersion,
  ) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    audioHash: String(row.audioHash),
    diarizationProvider: String(row.diarizationProvider),
    diarizationModel: normalizeModelFromStorage(row.diarizationModel),
    diarizationConfigVersion: String(row.diarizationConfigVersion),
    asrModel: normalizeModelFromStorage(row.asrModel),
    asrTextHash: String(row.asrTextHash),
    asrWordsHash: String(row.asrWordsHash),
    mergeConfigVersion: String(row.mergeConfigVersion),
    mediaOutputId: String(row.mediaOutputId),
    result: parseResult(row.resultJson as string) ?? [],
    createdAt: Number(row.createdAt),
  };
}

export async function getDiarizationMergeResultByMediaOutputId(
  mediaOutputId: string,
): Promise<AudioDiarizationMergeResult | null> {
  const db = await getDiarizationDb();
  const select = db.prepare(`
    SELECT * FROM merge_results WHERE mediaOutputId = ?
    ORDER BY createdAt DESC LIMIT 1
  `);
  const row = select.get(mediaOutputId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    audioHash: String(row.audioHash),
    diarizationProvider: String(row.diarizationProvider),
    diarizationModel: normalizeModelFromStorage(row.diarizationModel),
    diarizationConfigVersion: String(row.diarizationConfigVersion),
    asrModel: normalizeModelFromStorage(row.asrModel),
    asrTextHash: String(row.asrTextHash),
    asrWordsHash: String(row.asrWordsHash),
    mergeConfigVersion: String(row.mergeConfigVersion),
    mediaOutputId: String(row.mediaOutputId),
    result: parseResult(row.resultJson as string) ?? [],
    createdAt: Number(row.createdAt),
  };
}

export async function setDiarizationMergeResult(entry: AudioDiarizationMergeResult): Promise<void> {
  const db = await getDiarizationDb();
  const upsert = db.prepare(`
    INSERT INTO merge_results (
      audioHash, diarizationProvider, diarizationModel, diarizationConfigVersion,
      asrModel, asrTextHash, asrWordsHash, mergeConfigVersion, mediaOutputId,
      resultJson, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(
      audioHash, diarizationProvider, diarizationModel, diarizationConfigVersion,
      asrModel, asrTextHash, asrWordsHash, mergeConfigVersion
    )
    DO UPDATE SET resultJson = excluded.resultJson, mediaOutputId = excluded.mediaOutputId, createdAt = excluded.createdAt
  `);
  upsert.run(
    entry.audioHash,
    entry.diarizationProvider,
    normalizeModelForStorage(entry.diarizationModel),
    entry.diarizationConfigVersion,
    normalizeModelForStorage(entry.asrModel),
    entry.asrTextHash,
    entry.asrWordsHash,
    entry.mergeConfigVersion,
    entry.mediaOutputId,
    serializeResult(entry.result),
    entry.createdAt,
  );
}

export type SpeakerMappingRow = {
  agentId: string;
  speakerLabel: string;
  speakerDisplayName: string;
  attributionSource: string;
  confidence: number | null;
  confirmed: number;
  proposedAt: number;
  confirmedAt: number | null;
  contextHint: string | null;
};

export async function getSpeakerMapping(
  agentId: string,
  speakerLabel: string,
): Promise<SpeakerMappingRow | null> {
  const db = await getDiarizationDb();
  const select = db.prepare(
    "SELECT * FROM speaker_mappings WHERE agentId = ? AND speakerLabel = ?",
  );
  const row = select.get(agentId, speakerLabel) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return rowToSpeakerMapping(row);
}

export async function getSpeakerMappingsByAgent(
  agentId: string,
  options: { confirmed?: boolean } = {},
): Promise<SpeakerMappingRow[]> {
  const db = await getDiarizationDb();
  let query = "SELECT * FROM speaker_mappings WHERE agentId = ?";
  const params: (string | number)[] = [agentId];
  if (options.confirmed !== undefined) {
    query += " AND confirmed = ?";
    params.push(options.confirmed ? 1 : 0);
  }
  query += " ORDER BY proposedAt DESC";
  const select = db.prepare(query);
  const rows = select.all(...params) as Record<string, unknown>[];
  return rows.map(rowToSpeakerMapping);
}

export async function setSpeakerMapping(
  mapping: Omit<SpeakerMappingRow, "confirmedAt"> & { confirmedAt?: number | null },
): Promise<void> {
  const db = await getDiarizationDb();
  const upsert = db.prepare(`
    INSERT INTO speaker_mappings (
      agentId, speakerLabel, speakerDisplayName, attributionSource, confidence,
      confirmed, proposedAt, confirmedAt, contextHint
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agentId, speakerLabel)
    DO UPDATE SET
      speakerDisplayName = excluded.speakerDisplayName,
      attributionSource = excluded.attributionSource,
      confidence = excluded.confidence,
      confirmed = excluded.confirmed,
      proposedAt = excluded.proposedAt,
      confirmedAt = excluded.confirmedAt,
      contextHint = excluded.contextHint
  `);
  upsert.run(
    mapping.agentId,
    mapping.speakerLabel,
    mapping.speakerDisplayName,
    mapping.attributionSource,
    mapping.confidence ?? null,
    mapping.confirmed,
    mapping.proposedAt,
    mapping.confirmedAt ?? null,
    mapping.contextHint ?? null,
  );
}

export async function deleteSpeakerMapping(agentId: string, speakerLabel: string): Promise<void> {
  const db = await getDiarizationDb();
  const del = db.prepare("DELETE FROM speaker_mappings WHERE agentId = ? AND speakerLabel = ?");
  del.run(agentId, speakerLabel);
}

function rowToSpeakerMapping(row: Record<string, unknown>): SpeakerMappingRow {
  return {
    agentId: String(row.agentId),
    speakerLabel: String(row.speakerLabel),
    speakerDisplayName: String(row.speakerDisplayName),
    attributionSource: String(row.attributionSource),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    confirmed: Number(row.confirmed),
    proposedAt: Number(row.proposedAt),
    confirmedAt: row.confirmedAt != null ? Number(row.confirmedAt) : null,
    contextHint: row.contextHint != null ? String(row.contextHint) : null,
  };
}
