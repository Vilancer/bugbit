/**
 * Fetch every file in a pull request diff.
 *
 * `pulls.listFiles` defaults to 30 items per page. Without pagination, PRs with
 * more than 30 changed files are silently truncated — reviews miss whole files
 * and line-map validation rejects findings on page-2+ paths.
 *
 * @param {ReturnType<import('@actions/github').getOctokit>} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listPullRequestFiles(octokit, owner, repo, pullNumber) {
  return octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
}
