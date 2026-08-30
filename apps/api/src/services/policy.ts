/**
 * Persisted wellness policy (BRD sections 16-20).
 *
 * Administrators can retune the rules without a redeploy. The stored value is
 * merged over the defaults so a policy written by an older version of the app
 * still resolves once new rules are added.
 */
import { DEFAULT_POLICY, resolvePolicy, type PolicyConfig } from '@shift-planner/core';
import { prisma } from '../lib/prisma.js';

export async function getPolicy(): Promise<PolicyConfig> {
  const row = await prisma.policySetting.findUnique({ where: { id: 'default' } });
  if (!row) return { ...DEFAULT_POLICY };
  try {
    return resolvePolicy(JSON.parse(row.json) as Partial<PolicyConfig>);
  } catch {
    console.error('[policy] stored policy is not valid JSON; falling back to defaults');
    return { ...DEFAULT_POLICY };
  }
}

export async function savePolicy(patch: Partial<PolicyConfig>): Promise<PolicyConfig> {
  const merged = resolvePolicy({ ...(await getPolicy()), ...patch });
  await prisma.policySetting.upsert({
    where: { id: 'default' },
    create: { id: 'default', json: JSON.stringify(merged) },
    update: { json: JSON.stringify(merged) },
  });
  return merged;
}
