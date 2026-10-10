import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { prepareBaseRef, readPullRequestRefs } from '../src/runtime/prepareBaseRef';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, message: string): void {
  fs.writeFileSync(path.join(cwd, file), message);
  git(cwd, 'add', file);
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message);
}

/** Remote with main (60 commits) and a 3-commit feature branch; a depth-1 clone of the feature tip. */
function makeShallowPrCheckout(): { clone: string; headSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-baseref-'));
  const remote = path.join(root, 'remote');
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '-b', 'main');
  for (let i = 0; i < 60; i++) commit(remote, 'base.txt', `base ${i}`);
  git(remote, 'checkout', '-q', '-b', 'feature');
  for (let i = 0; i < 3; i++) commit(remote, 'feature.txt', `feature ${i}`);
  const headSha = git(remote, 'rev-parse', 'HEAD');
  git(remote, 'checkout', '-q', 'main');
  commit(remote, 'base.txt', 'main moved on');

  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', '--depth=1', '--branch', 'feature', `file://${remote}`, clone);
  git(clone, 'checkout', '-q', '--detach');
  return { clone, headSha };
}

describe('prepareBaseRef', () => {
  it('fetches the base branch, sets origin/HEAD, and deepens until the merge base exists', () => {
    const { clone, headSha } = makeShallowPrCheckout();
    expect(() => git(clone, 'merge-base', 'HEAD', 'origin/HEAD')).toThrow();

    expect(prepareBaseRef(clone, { baseRef: 'main', headSha })).toBe(true);

    expect(git(clone, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toBe('refs/remotes/origin/main');
    expect(git(clone, 'diff', '--name-only', 'origin/HEAD...HEAD')).toBe('feature.txt');
  });

  it('returns false instead of throwing when the base branch does not exist', () => {
    const { clone, headSha } = makeShallowPrCheckout();
    expect(prepareBaseRef(clone, { baseRef: 'no-such-branch', headSha })).toBe(false);
  });
});

describe('readPullRequestRefs', () => {
  it('reads base ref and head sha from the event payload', () => {
    const eventPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-event-')), 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { ref: 'main' }, head: { sha: 'abc' } } }));
    expect(readPullRequestRefs(eventPath)).toEqual({ baseRef: 'main', headSha: 'abc' });
    expect(readPullRequestRefs('/nonexistent')).toBeUndefined();
  });
});
