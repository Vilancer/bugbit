/** What a pass must have done before bugbit accepts it; shared by both agent runners. */
export interface PassCompletion {
  /** True once the pass did its job (e.g. post_review was called). */
  done: () => boolean;
  /** What is missing, for logs and the failure message (e.g. "a post_review call"). */
  missing: string;
  /** Follow-up user message sent when the model stopped early. */
  nudge: string;
  /** Follow-ups before failing the run. Default 2. */
  maxNudges?: number;
}

interface CallableTool {
  execute: (...args: never[]) => unknown;
}

/**
 * Wraps tools so the pass knows whether any of `required` was called, and returns the completion
 * check the agent runners use to resume a model that stopped before doing its job.
 */
export function requireToolCall<T extends Record<string, CallableTool>>(
  tools: T,
  required: readonly string[],
  nudge: string,
): { tools: T; completion: PassCompletion } {
  let called = false;
  const wrapped = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      required.includes(name)
        ? {
            ...tool,
            execute: async (...args: never[]) => {
              const result = await tool.execute(...args);
              called = true;
              return result;
            },
          }
        : tool,
    ]),
  ) as T;
  return {
    tools: wrapped,
    completion: { done: () => called, missing: `a ${required.join(' or ')} call`, nudge },
  };
}

export const REVIEW_NUDGE =
  'You stopped before finishing the review. Run any of the requested skills you have not run yet, ' +
  'then call post_review once with every finding (an empty findings array if there are none). ' +
  'The review is not done until post_review has been called.';

export const DESCRIBE_NUDGE =
  'You stopped before finishing. Call set_pr_labels, then update_pr_description with the ' +
  'auto-describe section. The pass is not done until update_pr_description has been called.';
