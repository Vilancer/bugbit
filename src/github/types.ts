export interface BugbitToolDeps {
  githubToken: string;
  eventPath: string;
  repository: string;
  actionPath: string;
  /** When true, post_review with zero findings posts a visible LGTM review. */
  postCleanSummary?: boolean;
  /** Review body used when posting a clean-summary LGTM. */
  cleanSummaryBody?: string;
  /** When true, runs an additional describe pass on the PR. */
  autoDescribe?: boolean;
  /** Parsed from describe-labels action input; applied after describe pass. */
  describeLabels?: string[];
}

export interface PrefetchedPrData {
  context: unknown;
  diff?: unknown;
  diffError?: { code: string; message: string };
}

export interface OpsDeps {
  token: string;
  eventPath: string;
  repository: string;
  postCleanSummary?: boolean;
  cleanSummaryBody?: string;
  autoDescribe?: boolean;
  describeLabels?: string[];
}
