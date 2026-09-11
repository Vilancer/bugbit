import { requirePullRequest } from './event.mjs';
import { listPullRequestFiles } from './list-pr-files.mjs';
import { createClient, parseRepo } from './octokit.mjs';
import { mapPullRequestFiles, DIFF_SIZE_LIMIT } from './parse-patch.mjs';
import { fetchDiffLineMap, validateFinding } from './validate.mjs';

/**
 * @typedef {{ token: string, eventPath: string, repository: string }} OpsDeps
 */

/**
 * @param {OpsDeps} deps
 */
export async function getPrContext(deps) {
  const pr = requirePullRequest(deps.eventPath);
  return {
    number: pr.number,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
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

  const output = { files };

  if (JSON.stringify(output).length > DIFF_SIZE_LIMIT) {
    const err = new Error(`Diff JSON exceeds ${DIFF_SIZE_LIMIT} bytes`);
    err.code = 'DIFF_TOO_LARGE';
    throw err;
  }

  return output;
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

/**
 * @param {OpsDeps} deps
 * @param {unknown[]} findings
 */
export async function postReview(deps, findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { posted: [], reviewId: null };
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
    body: 'bugbit review findings',
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
