import { describe, expect, it } from "vitest";
import { evaluateBranchProtection } from "./governance-policy";

const policy = {
  defaultBranch: {
    protected: true,
    requiredPullRequestReviews: true,
    minimumApprovals: 1,
    requiredStatusChecks: ["check"],
    enforceAdmins: true,
  },
};

describe("evaluateBranchProtection", () => {
  it("reports expected-state drift for an unprotected branch", () => {
    const evaluation = evaluateBranchProtection({
      branch: "main",
      protected: false,
      requiredStatusChecks: [],
      enforceAdmins: false,
      requiredPullRequestReviews: false,
      requiredApprovingReviewCount: 0,
      restrictions: false,
    }, policy);

    expect(evaluation.healthy).toBe(false);
    expect(evaluation.findings.map((finding) => finding.id)).toEqual([
      "branch-unprotected",
      "pull-request-reviews-not-required",
      "insufficient-approvals",
      "missing-status-check:check",
      "admins-not-enforced",
    ]);
  });

  it("is healthy when observed protection matches policy", () => {
    const evaluation = evaluateBranchProtection({
      branch: "main",
      protected: true,
      requiredStatusChecks: ["check"],
      enforceAdmins: true,
      requiredPullRequestReviews: true,
      requiredApprovingReviewCount: 1,
      restrictions: false,
    }, policy);

    expect(evaluation.healthy).toBe(true);
    expect(evaluation.findings).toEqual([]);
  });

  it("does not create findings when no policy is configured", () => {
    expect(evaluateBranchProtection(undefined, undefined)).toEqual({
      configured: false,
      healthy: true,
      findings: [],
    });
  });
});
