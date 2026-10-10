"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESCRIBE_NUDGE = exports.REVIEW_NUDGE = void 0;
exports.requireToolCall = requireToolCall;
/**
 * Wraps tools so the pass knows whether any of `required` was called, and returns the completion
 * check the agent runners use to resume a model that stopped before doing its job.
 */
function requireToolCall(tools, required, nudge) {
    let called = false;
    const wrapped = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [
        name,
        required.includes(name)
            ? {
                ...tool,
                execute: async (...args) => {
                    const result = await tool.execute(...args);
                    called = true;
                    return result;
                },
            }
            : tool,
    ]));
    return {
        tools: wrapped,
        completion: { done: () => called, missing: `a ${required.join(' or ')} call`, nudge },
    };
}
exports.REVIEW_NUDGE = 'You stopped before finishing the review. Run any of the requested skills you have not run yet, ' +
    'then call post_review once with every finding (an empty findings array if there are none). ' +
    'The review is not done until post_review has been called.';
exports.DESCRIBE_NUDGE = 'You stopped before finishing. Call set_pr_labels, then update_pr_description with the ' +
    'auto-describe section. The pass is not done until update_pr_description has been called.';
