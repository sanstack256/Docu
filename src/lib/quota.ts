import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PlanType = "free" | "pro";

export interface PlanLimits {
  plan: PlanType;
  maxExportsPerMonth: number;
  maxPagesPerExport: number;
  allowsCustomTitle: boolean;
  priority: "standard" | "high";
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    plan: "free",
    maxExportsPerMonth: 2,
    maxPagesPerExport: 20,
    allowsCustomTitle: false,
    priority: "standard",
  },
  pro: {
    plan: "pro",
    maxExportsPerMonth: 20,
    maxPagesPerExport: 500,
    allowsCustomTitle: true,
    priority: "high",
  },
};

export interface SubscriptionRecord {
  customerId: string;
  subscriptionId: string;
  status: "active" | "canceled" | "past_due";
  currentPeriodEnd: number;
  createdAt: number;
}

export interface QuotaRecord {
  sessionId: string;
  plan: PlanType;
  cycleStart: number;
  exportsUsed: number;
  subscription?: SubscriptionRecord;
}

export interface QuotaStatus {
  plan: PlanType;
  exportsUsed: number;
  exportsRemaining: number;
  maxExports: number;
  maxPagesPerExport: number;
  allowsCustomTitle: boolean;
  cycleRenewalDate: string;
  hasActiveSubscription: boolean;
}

const STORAGE_DIR = path.join(process.cwd(), ".docu_storage");
const QUOTAS_DIR = path.join(STORAGE_DIR, "quotas");
const BILLING_DIR = path.join(STORAGE_DIR, "billing");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function ensureQuotaDirs(): void {
  try {
    if (!fs.existsSync(QUOTAS_DIR)) fs.mkdirSync(QUOTAS_DIR, { recursive: true });
    if (!fs.existsSync(BILLING_DIR)) fs.mkdirSync(BILLING_DIR, { recursive: true });
  } catch {
    // Ignore if readonly
  }
}

// In-memory cache for fast lookups
declare global {
  // eslint-disable-next-line no-var
  var __docu_quotas: Map<string, QuotaRecord> | undefined;
}

const quotasMap: Map<string, QuotaRecord> =
  globalThis.__docu_quotas ?? (globalThis.__docu_quotas = new Map());

function loadQuotaFromDisk(sessionId: string): QuotaRecord | undefined {
  try {
    ensureQuotaDirs();
    const filePath = path.join(QUOTAS_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data as QuotaRecord;
    }
  } catch {
    // Ignore disk read errors
  }
  return undefined;
}

function persistQuotaToDisk(quota: QuotaRecord): void {
  try {
    ensureQuotaDirs();
    const filePath = path.join(QUOTAS_DIR, `${quota.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(quota), "utf-8");
  } catch {
    // Ignore disk write errors
  }
}

/**
 * Retrieves or initializes the quota record for a session ID.
 * Automatically resets the rolling 30-day window when expired.
 */
export function getOrCreateQuotaRecord(sessionId: string): QuotaRecord {
  const now = Date.now();
  let record = quotasMap.get(sessionId);

  if (!record) {
    record = loadQuotaFromDisk(sessionId);
  }

  if (!record) {
    record = {
      sessionId,
      plan: "free",
      cycleStart: now,
      exportsUsed: 0,
    };
  }

  // Check if subscription has expired
  if (record.subscription) {
    if (record.subscription.status === "active" && record.subscription.currentPeriodEnd > now) {
      record.plan = "pro";
    } else {
      record.plan = "free";
    }
  }

  // Reset rolling 30-day usage window if cycle expired
  if (now - record.cycleStart >= THIRTY_DAYS_MS) {
    record.cycleStart = now;
    record.exportsUsed = 0;
  }

  quotasMap.set(sessionId, record);
  persistQuotaToDisk(record);
  return record;
}

/**
 * Returns current user-facing quota status and remaining limits.
 */
export function getQuotaStatus(sessionId: string): QuotaStatus {
  const record = getOrCreateQuotaRecord(sessionId);
  const limits = PLAN_LIMITS[record.plan];
  const exportsRemaining = Math.max(0, limits.maxExportsPerMonth - record.exportsUsed);
  const cycleRenewal = new Date(record.cycleStart + THIRTY_DAYS_MS).toISOString();

  return {
    plan: record.plan,
    exportsUsed: record.exportsUsed,
    exportsRemaining,
    maxExports: limits.maxExportsPerMonth,
    maxPagesPerExport: limits.maxPagesPerExport,
    allowsCustomTitle: limits.allowsCustomTitle,
    cycleRenewalDate: cycleRenewal,
    hasActiveSubscription: Boolean(record.subscription && record.subscription.status === "active"),
  };
}

/**
 * Atomically attempts to consume 1 export from the session quota.
 * Enforces server-side quota limits.
 */
export function consumeExportQuota(
  sessionId: string,
  requestedPageCount: number,
  customTitleProvided: boolean
): { success: boolean; error?: string; remaining: number; plan: PlanType } {
  const record = getOrCreateQuotaRecord(sessionId);
  const limits = PLAN_LIMITS[record.plan];

  // 1. Check custom title entitlement
  if (customTitleProvided && !limits.allowsCustomTitle) {
    return {
      success: false,
      error: "Custom document titles require a Pro subscription. Upgrade to Pro for custom title support.",
      remaining: Math.max(0, limits.maxExportsPerMonth - record.exportsUsed),
      plan: record.plan,
    };
  }

  // 2. Check max pages per export
  if (requestedPageCount > limits.maxPagesPerExport) {
    return {
      success: false,
      error: `Page count (${requestedPageCount}) exceeds the ${record.plan.toUpperCase()} plan limit of ${limits.maxPagesPerExport} pages per manual.`,
      remaining: Math.max(0, limits.maxExportsPerMonth - record.exportsUsed),
      plan: record.plan,
    };
  }

  // 3. Check monthly export allowance
  if (record.exportsUsed >= limits.maxExportsPerMonth) {
    const renewalDateStr = new Date(record.cycleStart + THIRTY_DAYS_MS).toLocaleDateString();
    return {
      success: false,
      error: `You have reached your limit of ${limits.maxExportsPerMonth} exports for this 30-day period. Your quota resets on ${renewalDateStr}. Upgrade to Pro for 20 exports per month.`,
      remaining: 0,
      plan: record.plan,
    };
  }

  // Deduct quota
  record.exportsUsed++;
  quotasMap.set(sessionId, record);
  persistQuotaToDisk(record);

  return {
    success: true,
    remaining: limits.maxExportsPerMonth - record.exportsUsed,
    plan: record.plan,
  };
}

/**
 * Updates subscription details for a session (called after Stripe webhook verification).
 */
export function updateSessionSubscription(
  sessionId: string,
  subscription: SubscriptionRecord | null
): QuotaRecord {
  const record = getOrCreateQuotaRecord(sessionId);

  if (subscription && subscription.status === "active") {
    record.plan = "pro";
    record.subscription = subscription;
  } else {
    record.plan = "free";
    if (subscription) {
      record.subscription = subscription;
    } else {
      delete record.subscription;
    }
  }

  quotasMap.set(sessionId, record);
  persistQuotaToDisk(record);
  return record;
}

/**
 * Maps a Stripe customer ID to a local session ID.
 */
export function linkCustomerToSession(customerId: string, sessionId: string): void {
  try {
    ensureQuotaDirs();
    const filePath = path.join(BILLING_DIR, `${customerId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ sessionId, updatedAt: Date.now() }), "utf-8");
  } catch {
    // Ignore
  }
}

/**
 * Looks up session ID associated with a Stripe customer ID.
 */
export function getSessionByCustomerId(customerId: string): string | undefined {
  try {
    ensureQuotaDirs();
    const filePath = path.join(BILLING_DIR, `${customerId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.sessionId;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

