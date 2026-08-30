/**
 * Audit trail (BRD section 28).
 *
 * Every mutation records who acted, when, the previous and updated values and
 * the stated reason. Writes are best-effort: an audit failure must never take
 * down the operation the user actually asked for, but it is logged loudly.
 */
import { prisma } from '../lib/prisma.js';
import type { AuthenticatedUser } from '../middleware/auth.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  previousValue?: unknown;
  updatedValue?: unknown;
  reason?: string | null;
}

const serialise = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export async function recordAudit(
  actor: AuthenticatedUser | undefined,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actor?.id ?? null,
        userName: actor?.name ?? 'system',
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        previousValue: serialise(entry.previousValue),
        updatedValue: serialise(entry.updatedValue),
        reason: entry.reason ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error);
  }
}
