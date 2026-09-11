export interface BugbitToolDeps {
  githubToken: string;
  eventPath: string;
  repository: string;
  actionPath: string;
  /** When true, post_review with zero findings posts a visible LGTM review. */
  postCleanSummary?: boolean;
  /** Review body used when posting a clean-summary LGTM. */
  cleanSummaryBody?: string;
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
}
