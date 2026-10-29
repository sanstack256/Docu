import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DiscoveredPage } from "./crawler";

export type JobState =
  | "queued"
  | "discovering"
  | "awaiting_selection"
  | "processing"
  | "generating_pdf"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export interface FailedPageRecord {
  url: string;
  error: string;
}

export interface JobRecord {
  id: string;
  url: string;
  siteTitle: string;
  state: JobState;
  discoveredPages: DiscoveredPage[];
  selectedPages: string[];
  processedPages: number;
  totalSelected: number;
  failedPages: FailedPageRecord[];
  warnings: string[];
  error?: string;
  downloadToken?: string;
  downloadFileName?: string;
  fileSizeBytes?: number;
  pdfBuffer?: Buffer;
  createdAt: number;
  expiresAt: number;
}

// 1 hour retention
const RETENTION_MS = 60 * 60 * 1000;

// Disk persistence paths
const STORAGE_DIR = path.join(process.cwd(), ".docu_storage");
const JOBS_DIR = path.join(STORAGE_DIR, "jobs");
const DOWNLOADS_DIR = path.join(STORAGE_DIR, "downloads");
const TOKENS_DIR = path.join(STORAGE_DIR, "tokens");

function ensureStorageDirs(): void {
  try {
    if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

// Global in-memory cache shared across Next.js route bundles and reloads
declare global {
  // eslint-disable-next-line no-var
  var __docu_jobs: Map<string, JobRecord> | undefined;
  // eslint-disable-next-line no-var
  var __docu_tokens: Map<string, string> | undefined;
}

const jobsMap: Map<string, JobRecord> =
  globalThis.__docu_jobs ?? (globalThis.__docu_jobs = new Map());
const tokenToJobMap: Map<string, string> =
  globalThis.__docu_tokens ?? (globalThis.__docu_tokens = new Map());

function persistJobToDisk(job: JobRecord): void {
  try {
    ensureStorageDirs();
    const filePath = path.join(JOBS_DIR, `${job.id}.json`);
    const { pdfBuffer, ...metadata } = job;
    fs.writeFileSync(filePath, JSON.stringify(metadata), "utf-8");
  } catch {
    // Ignore disk write errors
  }
}

function loadJobFromDisk(id: string): JobRecord | undefined {
  try {
    const filePath = path.join(JOBS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data as JobRecord;
    }
  } catch {
    // Ignore disk read errors
  }
  return undefined;
}

export function cleanupExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of Array.from(jobsMap.entries())) {
    if (job.expiresAt <= now) {
      if (job.downloadToken) {
        tokenToJobMap.delete(job.downloadToken);
      }
      jobsMap.delete(id);
    }
  }

  // Also sweep disk storage for expired files
  try {
    if (fs.existsSync(TOKENS_DIR)) {
      const files = fs.readdirSync(TOKENS_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const tokenFilePath = path.join(TOKENS_DIR, file);
        const stats = fs.statSync(tokenFilePath);
        if (now - stats.mtimeMs > RETENTION_MS) {
          const token = file.replace(/\.json$/, "");
          const pdfPath = path.join(DOWNLOADS_DIR, `${token}.pdf`);
          try {
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
            fs.unlinkSync(tokenFilePath);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

export function createJob(targetUrl: string): JobRecord {
  cleanupExpiredJobs();

  const id = crypto.randomUUID();
  const now = Date.now();

  const job: JobRecord = {
    id,
    url: targetUrl,
    siteTitle: new URL(targetUrl).hostname,
    state: "queued",
    discoveredPages: [],
    selectedPages: [],
    processedPages: 0,
    totalSelected: 0,
    failedPages: [],
    warnings: [],
    createdAt: now,
    expiresAt: now + RETENTION_MS,
  };

  jobsMap.set(id, job);
  persistJobToDisk(job);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  cleanupExpiredJobs();
  const memoryJob = jobsMap.get(id);
  if (memoryJob) return memoryJob;

  const diskJob = loadJobFromDisk(id);
  if (diskJob && diskJob.expiresAt > Date.now()) {
    jobsMap.set(id, diskJob);
    if (diskJob.downloadToken) {
      tokenToJobMap.set(diskJob.downloadToken, id);
    }
    return diskJob;
  }
  return undefined;
}

export function updateJob(id: string, updates: Partial<JobRecord>): JobRecord | undefined {
  let job = jobsMap.get(id);
  if (!job) {
    job = loadJobFromDisk(id);
  }
  if (!job) return undefined;

  Object.assign(job, updates);
  jobsMap.set(id, job);
  persistJobToDisk(job);
  return job;
}

export function finalizeJobWithPDF(id: string, buffer: Buffer, fileName: string): JobRecord | undefined {
  let job = jobsMap.get(id);
  if (!job) {
    job = loadJobFromDisk(id);
  }
  if (!job) return undefined;

  const downloadToken = crypto.randomBytes(24).toString("hex");

  job.downloadToken = downloadToken;
  job.downloadFileName = fileName;
  job.fileSizeBytes = buffer.byteLength;
  job.pdfBuffer = buffer;
  job.state = job.failedPages.length > 0 || job.warnings.length > 0 ? "completed_with_warnings" : "completed";

  jobsMap.set(id, job);
  tokenToJobMap.set(downloadToken, id);
  persistJobToDisk(job);

  // Persist PDF binary and token mapping to disk
  try {
    ensureStorageDirs();
    const pdfPath = path.join(DOWNLOADS_DIR, `${downloadToken}.pdf`);
    fs.writeFileSync(pdfPath, buffer);

    const tokenMetaPath = path.join(TOKENS_DIR, `${downloadToken}.json`);
    fs.writeFileSync(
      tokenMetaPath,
      JSON.stringify({
        jobId: id,
        fileName,
        fileSizeBytes: buffer.byteLength,
        createdAt: Date.now(),
      }),
      "utf-8"
    );
  } catch {
    // If disk write fails, in-memory cache remains active
  }

  return job;
}

export function getPDFByDownloadToken(token: string): { fileName: string; buffer: Buffer } | undefined {
  cleanupExpiredJobs();

  // 1. Check in-memory state
  const jobId = tokenToJobMap.get(token);
  if (jobId) {
    const job = jobsMap.get(jobId);
    if (job && job.pdfBuffer) {
      return {
        fileName: job.downloadFileName || "documentation-manual.pdf",
        buffer: job.pdfBuffer,
      };
    }
  }

  // 2. Check disk storage (handles Next.js route isolation, hot reloads, worker restarts)
  try {
    ensureStorageDirs();
    const pdfPath = path.join(DOWNLOADS_DIR, `${token}.pdf`);
    const tokenMetaPath = path.join(TOKENS_DIR, `${token}.json`);

    if (fs.existsSync(pdfPath)) {
      let fileName = "documentation-manual.pdf";
      if (fs.existsSync(tokenMetaPath)) {
        const meta = JSON.parse(fs.readFileSync(tokenMetaPath, "utf-8"));
        // Enforce 1-hour expiration on disk reads
        if (Date.now() - meta.createdAt > RETENTION_MS) {
          try {
            fs.unlinkSync(pdfPath);
            fs.unlinkSync(tokenMetaPath);
          } catch {
            // Ignore
          }
          return undefined;
        }
        if (meta.fileName) fileName = meta.fileName;
      }
      const buffer = fs.readFileSync(pdfPath);
      return { fileName, buffer };
    }
  } catch {
    // Ignore disk read error and fallback to undefined
  }

  return undefined;
}
