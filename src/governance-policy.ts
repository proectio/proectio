import type { BranchProtectionSummary } from "./github";

export interface BranchProtectionPolicy {
  protected?: boolean;
  requiredPullRequestReviews?: boolean;
  minimumApprovals?: number;
  requiredStatusChecks?: string[];
  enforceAdmins?: boolean;
}

export interface GovernancePolicy {
  defaultBranch?: BranchProtectionPolicy;
}

export interface GovernanceFinding {
  id: string;
  message: string;
  expected: string;
  actual: string;
}

export interface GovernanceEvaluation {
  configured: boolean;
  healthy: boolean;
  findings: GovernanceFinding[];
  expected?: BranchProtectionPolicy;
}

export function evaluateBranchProtection(
  observed: BranchProtectionSummary | undefined,
  policy: GovernancePolicy | undefined,
): GovernanceEvaluation {
  const expected = policy?.defaultBranch;
  if (!expected) return { configured: false, healthy: true, findings: [] };

  if (!observed) {
    return {
      configured: true,
      healthy: false,
      expected,
      findings: [{
        id: "branch-protection-unavailable",
        message: "Branch protection state is unavailable",
        expected: "Branch protection state available",
        actual: "Unavailable",
      }],
    };
  }

  const findings: GovernanceFinding[] = [];

  if (expected.protected === true && !observed.protected) {
    findings.push({
      id: "branch-unprotected",
      message: `${observed.branch} is not protected`,
      expected: "Protected branch",
      actual: "Unprotected branch",
    });
  }

  if (expected.requiredPullRequestReviews === true && !observed.requiredPullRequestReviews) {
    findings.push({
      id: "pull-request-reviews-not-required",
      message: "Pull request reviews are not required before merge",
      expected: "Pull request reviews required",
      actual: "Not required",
    });
  }

  const minimumApprovals = expected.minimumApprovals ?? 0;
  if (minimumApprovals > observed.requiredApprovingReviewCount) {
    findings.push({
      id: "insufficient-approvals",
      message: `Only ${observed.requiredApprovingReviewCount} approving review${observed.requiredApprovingReviewCount === 1 ? "" : "s"} required`,
      expected: `${minimumApprovals} approving review${minimumApprovals === 1 ? "" : "s"}`,
      actual: String(observed.requiredApprovingReviewCount),
    });
  }

  for (const check of expected.requiredStatusChecks ?? []) {
    if (!observed.requiredStatusChecks.includes(check)) {
      findings.push({
        id: `missing-status-check:${check}`,
        message: `Required status check ${check} is missing`,
        expected: `Required check: ${check}`,
        actual: observed.requiredStatusChecks.length > 0 ? observed.requiredStatusChecks.join(", ") : "No required checks",
      });
    }
  }

  if (expected.enforceAdmins === true && !observed.enforceAdmins) {
    findings.push({
      id: "admins-not-enforced",
      message: "Branch protection does not apply to administrators",
      expected: "Protection applies to administrators",
      actual: "Administrators exempt",
    });
  }

  return {
    configured: true,
    healthy: findings.length === 0,
    findings,
    expected,
  };
}
