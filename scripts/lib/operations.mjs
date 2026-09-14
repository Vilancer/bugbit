import { requirePullRequest } from './event.mjs';
import { listPullRequestFiles } from './list-pr-files.mjs';
import { createClient, parseRepo } from './octokit.mjs';
import { mapPullRequestFiles, buildSizedDiff } from './parse-patch.mjs';
import { fetchDiffLineMap, validateFinding } from './validate.mjs';

/**
 * @typedef {{ token: string, eventPath: string, repository: string }} OpsDeps
 */

/**
 * @param {OpsDeps} deps
 */
export async function getPrContext(deps) {
  const pr = requirePullRequest(deps.eventPath);
  let title = typeof pr.title === 'string' ? pr.title : '';
  let body = typeof pr.body === 'string' ? pr.body : '';

  try {
    const octokit = createClient(deps.token);
    const { owner, repo } = parseRepo(deps.repository);
    const { data: livePr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number,
    });
    if (typeof livePr.title === 'string') {
      title = livePr.title;
    }
    body = typeof livePr.body === 'string' ? livePr.body : '';
  } catch {
    // Fall back to event payload.
  }

  return {
    number: pr.number,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    title,
    body,
  };
}

/**
 * @param {OpsDeps} deps
 */
export async function getDiff(deps) {
  const pr = requirePullRequest(deps.eventPath);
  const octokit = createClient(deps.token);
  const { owner, repo } = parseRepo(deps.repository);

  const fileList = await listPullRequestFiles(octokit, owner, repo, pr.number);

  const files = mapPullRequestFiles(fileList);
  return buildSizedDiff(files);
}

/**
 * @param {unknown} finding
 * @param {number} index
 */
function validateFindingShape(finding, index) {
  if (!finding || typeof finding !== 'object') {
    return {
      valid: false,
      error: {
        index,
        code: 'INVALID_FINDING',
        message: 'Finding must be an object',
      },
    };
  }

  const { mode, path, line, body } = finding;
  const pathValue = typeof path === 'string' ? path : undefined;
  const lineValue = typeof line === 'number' ? line : undefined;

  if (!mode || !pathValue || lineValue == null || !body) {
    return {
      valid: false,
      error: {
        index,
        path: pathValue,
        line: lineValue,
        code: 'INVALID_FINDING',
        message: 'Finding must include mode, path, line, and body',
      },
    };
  }

  return {
    valid: true,
    finding: { mode, path: pathValue, line: lineValue, body },
  };
}

const DEFAULT_CLEAN_SUMMARY_BODY =
  '## bugbit: LGTM — no findings\n\nNo issues reported on this diff.';

/**
 * @param {OpsDeps} deps
 * @param {unknown[]} findings
 */
export async function postReview(deps, findings) {
  if (!Array.isArray(findings)) {
    return {
      error: {
        code: 'INVALID_ARGS',
        message: 'findings must be an array',
      },
    };
  }

  if (findings.length === 0) {
    if (!deps.postCleanSummary) {
      return { posted: [], reviewId: null, cleanSummary: false };
    }

    const pr = requirePullRequest(deps.eventPath);
    const octokit = createClient(deps.token);
    const { owner, repo } = parseRepo(deps.repository);
    const body =
      typeof deps.cleanSummaryBody === 'string' && deps.cleanSummaryBody.trim()
        ? deps.cleanSummaryBody.trim()
        : DEFAULT_CLEAN_SUMMARY_BODY;

    const { data } = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pr.number,
      commit_id: pr.head.sha,
      event: 'COMMENT',
      body,
    });

    return { posted: [], reviewId: data.id, cleanSummary: true };
  }

  const pr = requirePullRequest(deps.eventPath);
  const octokit = createClient(deps.token);
  const { owner, repo } = parseRepo(deps.repository);
  const lineMap = await fetchDiffLineMap(octokit, owner, repo, pr.number);

  /** @type {Array<{ mode: string, path: string, line: number, body: string }>} */
  const validFindings = [];
  /** @type {Array<{ index: number, path?: string, line?: number, code: string, message: string }>} */
  const errors = [];

  for (let i = 0; i < findings.length; i++) {
    const shapeResult = validateFindingShape(findings[i], i);
    if (!shapeResult.valid) {
      errors.push(shapeResult.error);
      continue;
    }

    const { path, line, body, mode } = shapeResult.finding;
    const diffResult = validateFinding(path, line, lineMap);

    if (!diffResult.valid) {
      errors.push({
        index: i,
        path,
        line,
        code: diffResult.code,
        message: diffResult.message,
      });
      continue;
    }

    validFindings.push({ mode, path, line, body });
  }

  if (validFindings.length === 0) {
    return { posted: [], errors, reviewId: null };
  }

  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pr.number,
    commit_id: pr.head.sha,
    event: 'COMMENT',
    body: `bugbit: ${validFindings.length} finding(s)`,
    comments: validFindings.map((f) => ({
      path: f.path,
      line: f.line,
      side: 'RIGHT',
      body: f.body,
    })),
  });

  const responseComments = data.comments ?? [];
  const posted = validFindings.map((f, i) => ({
    path: f.path,
    line: f.line,
    commentId: responseComments[i]?.id ?? null,
  }));

  return { posted, errors, reviewId: data.id };
}

/**
 * @param {OpsDeps} deps
 * @param {{ path: string, line: number, body: string }} input
 */
export async function postInlineComment(deps, { path, line, body }) {
  if (!path || line == null || Number.isNaN(line) || !body) {
    return {
      error: {
        code: 'INVALID_ARGS',
        message: 'Missing required path, line, or body',
      },
    };
  }

  const pr = requirePullRequest(deps.eventPath);
  const octokit = createClient(deps.token);
  const { owner, repo } = parseRepo(deps.repository);

  const lineMap = await fetchDiffLineMap(octokit, owner, repo, pr.number);
  const result = validateFinding(path, line, lineMap);

  if (!result.valid) {
    return { error: { code: result.code, message: result.message } };
  }

  const { data } = await octokit.rest.pulls.createReviewComment({
    owner,
    repo,
    pull_number: pr.number,
    commit_id: pr.head.sha,
    path,
    line,
    side: 'RIGHT',
    body,
  });

  return {
    posted: [{ path, line, commentId: data.id }],
    reviewId: null,
  };
}

/** Markers that wrap the auto-describe section so re-runs replace it without touching author text. */
export const AUTO_DESCRIBE_START = '<!-- bugbit-auto-describe:start -->';
export const AUTO_DESCRIBE_END = '<!-- bugbit-auto-describe:end -->';

/**
 * True when the PR body already contains a bugbit auto-describe block.
 * @param {string} text
 * @returns {boolean}
 */
export function hasAutoDescribeSection(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return text.includes(AUTO_DESCRIBE_START) && text.includes(AUTO_DESCRIBE_END);
}

/**
 * Remove any previously written auto-describe block from a PR body.
 * @param {string} text
 * @returns {string}
 */
export function stripAutoDescribeSection(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  const pattern = new RegExp(
    `${escapeRegExp(AUTO_DESCRIBE_START)}[\\s\\S]*?${escapeRegExp(AUTO_DESCRIBE_END)}\\s*`,
    'g',
  );
  return text.replace(pattern, '').trimEnd();
}

/**
 * Merge developer-authored PR body with a newly generated auto-describe section.
 * Author text is preserved; prior auto-describe blocks are replaced.
 * @param {string} existingBody
 * @param {string} generatedBody
 * @returns {string}
 */
export function mergeAutoDescribeBody(existingBody, generatedBody) {
  const authorPart = stripAutoDescribeSection(existingBody || '').trim();
  const generated = stripAutoDescribeSection(generatedBody || '').trim();
  if (!generated) {
    return authorPart;
  }
  const block = `${AUTO_DESCRIBE_START}\n${generated}\n${AUTO_DESCRIBE_END}`;
  if (!authorPart) {
    return block;
  }
  return `${authorPart}\n\n${block}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update the PR title and/or body.
 * Body is merged: the developer's existing text is kept, and the generated
 * auto-describe section is appended (or replaced on re-run).
 * @param {OpsDeps} deps
 * @param {{ title?: string, body: string }} input
 */
export async function updatePrDescription(deps, { title, body }) {
  if (!deps.autoDescribe) {
    return {
      error: {
        code: 'DESCRIBE_DISABLED',
        message: 'update_pr_description is only available during the auto-describe pass',
      },
    };
  }

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return {
      error: {
        code: 'INVALID_ARGS',
        message: 'Missing required body',
      },
    };
  }

  const pr = requirePullRequest(deps.eventPath);
  const octokit = createClient(deps.token);
  const { owner, repo } = parseRepo(deps.repository);

  let existingBody = typeof pr.body === 'string' ? pr.body : '';
  try {
    const { data: livePr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number,
    });
    existingBody = typeof livePr.body === 'string' ? livePr.body : '';
  } catch {
    // Fall back to event payload body.
  }

  if (hasAutoDescribeSection(existingBody)) {
    const params = {
      owner,
      repo,
      pull_number: pr.number,
    };
    if (title && typeof title === 'string' && title.trim().length > 0) {
      params.title = title;
      const { data } = await octokit.rest.pulls.update(params);
      return { updated: true, id: data.id, skippedDescribe: true, preservedAuthorBody: true };
    }
    return { updated: false, skippedDescribe: true, preservedAuthorBody: true };
  }

  const mergedBody = mergeAutoDescribeBody(existingBody, body);

  const params = {
    owner,
    repo,
    pull_number: pr.number,
    body: mergedBody,
  };
  if (title && typeof title === 'string' && title.trim().length > 0) {
    params.title = title;
  }

  const { data } = await octokit.rest.pulls.update(params);
  return {
    updated: true,
    id: data.id,
    preservedAuthorBody: Boolean(stripAutoDescribeSection(existingBody).trim()),
  };
}

const INFERRED_TYPE_LABELS = new Set([
  'feature',
  'bug-fix',
  'enhancement',
  'refactor',
  'docs',
  'chore',
  'breaking-change',
]);

const REVIEW_EFFORT_LABEL = /^Review effort [1-5]\/5$/;
const MAX_LABEL_NAME = 50;
const MAX_LABELS = 20;

/**
 * Keep inferred catalog labels plus workflow-configured describe-labels.
 * Drops arbitrary agent-invented names so prompt injection cannot create
 * automerge / security-reviewed style labels.
 * @param {{ describeLabels?: string[] }} deps
 * @param {unknown} agentLabels
 * @returns {string[]}
 */
export function resolvePrLabels(deps, agentLabels) {
  const configured = [];
  if (Array.isArray(deps.describeLabels)) {
    for (const raw of deps.describeLabels) {
      if (typeof raw !== 'string') {
        continue;
      }
      const name = raw.trim();
      if (name && name.length <= MAX_LABEL_NAME) {
        configured.push(name);
      }
    }
  }

  const inferred = [];
  if (Array.isArray(agentLabels)) {
    for (const raw of agentLabels) {
      if (typeof raw !== 'string') {
        continue;
      }
      const name = raw.trim();
      if (!name || name.length > MAX_LABEL_NAME) {
        continue;
      }
      if (
        INFERRED_TYPE_LABELS.has(name) ||
        REVIEW_EFFORT_LABEL.test(name) ||
        configured.includes(name)
      ) {
        inferred.push(name);
      }
    }
  }

  const merged = [];
  const seen = new Set();
  for (const name of [...inferred, ...configured]) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    merged.push(name);
    if (merged.length >= MAX_LABELS) {
      break;
    }
  }
  return merged;
}

/**
 * Apply a list of labels to the PR (uses the issues API, requires issues: write).
 * Creates missing labels so inferred type / review-effort names work on first use.
 * @param {OpsDeps} deps
 * @param {{ labels: string[] }} input
 */
export async function setPrLabels(deps, { labels }) {
  if (!deps.autoDescribe) {
    return {
      error: {
        code: 'DESCRIBE_DISABLED',
        message: 'set_pr_labels is only available during the auto-describe pass',
      },
    };
  }

  if (!Array.isArray(labels)) {
    return {
      error: {
        code: 'INVALID_ARGS',
        message: 'labels must be a non-empty array',
      },
    };
  }

  const resolved = resolvePrLabels(deps, labels);
  if (resolved.length === 0) {
    return {
      error: {
        code: 'INVALID_ARGS',
        message: 'labels must be a non-empty array',
      },
    };
  }

  const pr = requirePullRequest(deps.eventPath);
  const octokit = createClient(deps.token);
  const { owner, repo } = parseRepo(deps.repository);

  for (const name of resolved) {
    try {
      await octokit.rest.issues.getLabel({ owner, repo, name });
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      if (status !== 404) {
        throw error;
      }
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name,
        color: 'ededed',
      });
    }
  }

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pr.number,
    labels: resolved,
  });
  return { applied: resolved };
}
