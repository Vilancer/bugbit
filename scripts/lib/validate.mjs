import { mapPullRequestFiles, buildLineMap } from './parse-patch.mjs';
import { listPullRequestFiles } from './list-pr-files.mjs';

/**
 * @param {string} path
 * @param {number} line
 * @param {Map<string, Set<number>>} lineMap
 * @returns {{ valid: true } | { valid: false, code: string, message: string }}
 */
export function validateFinding(path, line, lineMap) {
  if (!lineMap.has(path)) {
    return {
      valid: false,
      code: 'PATH_NOT_IN_DIFF',
      message: `Path not in PR diff: ${path}`,
    };
  }

  if (!lineMap.get(path).has(line)) {
    return {
      valid: false,
      code: 'LINE_NOT_IN_DIFF',
      message: `Line ${line} not in diff hunk for ${path}`,
    };
  }

  return { valid: true };
}

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<Map<string, Set<number>>>}
 */
export async function fetchDiffLineMap(octokit, owner, repo, pullNumber) {
  const fileList = await listPullRequestFiles(octokit, owner, repo, pullNumber);

  const files = mapPullRequestFiles(fileList);

  return buildLineMap(files);
}
