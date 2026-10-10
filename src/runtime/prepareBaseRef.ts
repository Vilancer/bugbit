import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as core from '@actions/core';

const DEEPEN_STEP = 50;
const MAX_DEEPEN_ROUNDS = 10;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function succeeds(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

export interface PullRequestRefs {
  baseRef: string;
  headSha: string;
}

export function readPullRequestRefs(eventPath: string): PullRequestRefs | undefined {
  try {
    const pr = JSON.parse(fs.readFileSync(eventPath, 'utf8')).pull_request;
    const baseRef = pr?.base?.ref;
    const headSha = pr?.head?.sha;
    return typeof baseRef === 'string' && typeof headSha === 'string' ? { baseRef, headSha } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Makes `origin/HEAD` point at the PR base branch with a reachable merge base, so Claude Code
 * skills that diff against it (`/security-review` runs `git diff origin/HEAD...`) work on the
 * default shallow `actions/checkout`. Best effort: failures only degrade those skills.
 */
export function prepareBaseRef(cwd: string, refs: PullRequestRefs): boolean {
  const remoteRef = `refs/remotes/origin/${refs.baseRef}`;
  try {
    // On a shallow checkout fetch the base shallow too, or it pulls the base branch's full history.
    const shallow = git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true';
    git(cwd, [
      'fetch',
      '--no-tags',
      '--quiet',
      ...(shallow ? [`--depth=${DEEPEN_STEP}`] : []),
      'origin',
      `+refs/heads/${refs.baseRef}:${remoteRef}`,
    ]);
    git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', remoteRef]);

    for (let round = 0; !succeeds(cwd, ['merge-base', 'HEAD', remoteRef]); round++) {
      if (round >= MAX_DEEPEN_ROUNDS || !shallow) {
        core.warning(
          `No merge base between HEAD and origin/${refs.baseRef}; skills that diff against origin/HEAD may fail. ` +
            'Use actions/checkout with fetch-depth: 0 to avoid this.',
        );
        return false;
      }
      git(cwd, [
        'fetch',
        '--no-tags',
        '--quiet',
        `--deepen=${DEEPEN_STEP}`,
        'origin',
        refs.headSha,
        `+refs/heads/${refs.baseRef}:${remoteRef}`,
      ]);
    }

    core.info(`origin/HEAD → origin/${refs.baseRef} (merge base reachable)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    core.warning(`Could not fetch origin/${refs.baseRef} for Claude skills: ${message}`);
    return false;
  }
}
