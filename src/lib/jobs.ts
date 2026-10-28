import crypto from "node:crypto";
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

// In-memory store for Version 1
const jobsMap = new Map<string, JobRecord>();
const tokenToJobMap = new Map<string, string>(); // token -> jobId

// 1 hour retention
const RETENTION_MS = 60 * 60 * 1000;

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
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  cleanupExpiredJobs();
  return jobsMap.get(id);
}

export function updateJob(id: string, updates: Partial<JobRecord>): JobRecord | undefined {
  const job = jobsMap.get(id);
  if (!job) return undefined;

  Object.assign(job, updates);
  jobsMap.set(id, job);
  return job;
}

export function finalizeJobWithPDF(id: string, buffer: Buffer, fileName: string): JobRecord | undefined {
  const job = jobsMap.get(id);
  if (!job) return undefined;

  const downloadToken = crypto.randomBytes(24).toString("hex");

  job.downloadToken = downloadToken;
  job.downloadFileName = fileName;
  job.fileSizeBytes = buffer.byteLength;
  job.pdfBuffer = buffer;
  job.state = job.failedPages.length > 0 || job.warnings.length > 0 ? "completed_with_warnings" : "completed";

  tokenToJobMap.set(downloadToken, id);
  return job;
}

export function getPDFByDownloadToken(token: string): { fileName: string; buffer: Buffer } | undefined {
  cleanupExpiredJobs();
  const jobId = tokenToJobMap.get(token);
  if (!jobId) return undefined;

  const job = jobsMap.get(jobId);
  if (!job || !job.pdfBuffer) return undefined;

  return {
    fileName: job.downloadFileName || "documentation-manual.pdf",
    buffer: job.pdfBuffer,
  };
}
