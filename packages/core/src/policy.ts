/**
 * Workforce wellness and compliance policy (BRD sections 16-20).
 *
 * Everything the validation and roster engines treat as a rule lives here, so a
 * business can retune the policy without touching engine code. The defaults
 * encode the document exactly; the traceability notes in `docs/` explain the two
 * places where the document was ambiguous and a decision was made.
 */
export interface PolicyConfig {
  /**
   * Minimum hours between the end of one shift and the start of the next
   * (BRD section 18). Falling short raises a warning, not a block, because the
   * document scopes hard restrictions to the enumerated transition list.
   */
  minRestHours: number;
  /** BRD section 19 — every employee gets at least this many offs per week. */
  minWeeklyOffs: number;
  /** BRD section 20 — 7 consecutive working days is never allowed. */
  maxConsecutiveDays: number;
  /** BRD section 20 — 6 consecutive days is an exception and warns. */
  exceptionConsecutiveDays: number;
  /** BRD section 20 — 5 consecutive days is the preferred pattern. */
  preferredConsecutiveDays: number;
  /** BRD section 17 — transitions that require a management override. */
  restrictedTransitions: Array<[string, string]>;
  /** BRD section 17 — transitions the roster engine actively favours. */
  preferredTransitions: Array<[string, string]>;
  /** BRD section 16 — more shift changes than this in one week warns. */
  maxShiftChangesPerWeek: number;
  /**
   * BRD section 25 — fraction by which an employee's workload may deviate from
   * the team mean before "uneven distribution" is reported.
   */
  distributionTolerance: number;
  /**
   * Share of a shift's minimum staffing that must still be covered on a public
   * holiday (BRD section 15, "business-defined coverage requirements apply").
   */
  holidayCoverageRatio: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  minRestHours: 11,
  minWeeklyOffs: 1,
  maxConsecutiveDays: 6,
  exceptionConsecutiveDays: 6,
  preferredConsecutiveDays: 5,
  restrictedTransitions: [
    ['S1', 'S3'],
    ['S3', 'S1'],
  ],
  preferredTransitions: [
    ['S1', 'S2'],
    ['S2', 'S3'],
  ],
  maxShiftChangesPerWeek: 1,
  distributionTolerance: 0.25,
  holidayCoverageRatio: 0.5,
};

export function resolvePolicy(overrides?: Partial<PolicyConfig>): PolicyConfig {
  return { ...DEFAULT_POLICY, ...(overrides ?? {}) };
}

/** True when moving from `fromCode` to `toCode` needs a management override. */
export function isRestrictedTransition(
  policy: PolicyConfig,
  fromCode: string,
  toCode: string,
): boolean {
  return policy.restrictedTransitions.some(
    ([from, to]) => from === fromCode && to === toCode,
  );
}

export function isPreferredTransition(
  policy: PolicyConfig,
  fromCode: string,
  toCode: string,
): boolean {
  return policy.preferredTransitions.some(
    ([from, to]) => from === fromCode && to === toCode,
  );
}
