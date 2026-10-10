import { checkToolUse, reviewGuardHooks, splitCommand } from '../src/agent/claudeGuard';

describe('checkToolUse: Bash', () => {
  it.each([
    'git diff origin/HEAD...HEAD',
    'git log --oneline -5',
    'git log --format="%h %s" -3',
    'git show HEAD:src/users.js',
    'git merge-base HEAD origin/main',
    'git blame -L 10,20 src/users.js',
  ])('allows read-only %s', (command) => {
    expect(checkToolUse('Bash', { command })).toBeUndefined();
  });

  it.each([
    ['git diff --output=README.md', /--output/],
    ['git diff HEAD --output README.md', /--output/],
    ['git diff --no-index /proc/self/environ /dev/null', /--no-index/],
    ['git branch -D main', /read-only git/],
    ['git -c core.pager=sh diff', /read-only git/],
    ['git push origin HEAD', /read-only git/],
    ['cat .env', /read-only git/],
    ['git diff | head', /single plain git/],
    ['git log && rm -rf .', /single plain git/],
    ['git show $(cat /etc/passwd)', /single plain git/],
    ['git log --format="%h', /read-only git/],
  ])('refuses %s', (command, reason) => {
    expect(checkToolUse('Bash', { command })).toMatch(reason);
  });
});

describe('checkToolUse: file tools', () => {
  it.each([
    ['Read', { file_path: '/home/runner/work/repo/repo/.git/config' }],
    ['Read', { file_path: '.env' }],
    ['Read', { file_path: 'config/.env.production' }],
    ['Read', { file_path: '/proc/self/environ' }],
    ['Read', { file_path: 'certs/server.pem' }],
    ['Read', { file_path: '/home/runner/.ssh/id_ed25519' }],
    ['Grep', { pattern: 'token', path: '/proc' }],
    ['Read', { file_path: '/runner/_temp/git-credentials-123.config' }],
  ])('refuses %s %j', (tool, input) => {
    expect(checkToolUse(tool, input, '/runner/_temp')).toMatch(/credentials/);
  });

  it('allows ordinary source files and searches', () => {
    expect(checkToolUse('Read', { file_path: 'src/users.js' }, '/runner/_temp')).toBeUndefined();
    expect(checkToolUse('Grep', { pattern: 'apiKey', path: 'src' }, '/runner/_temp')).toBeUndefined();
    expect(checkToolUse('Glob', { pattern: '**/*.ts' }, '/runner/_temp')).toBeUndefined();
  });
});

describe('splitCommand', () => {
  it('keeps quoted words together and rejects unbalanced quotes', () => {
    expect(splitCommand('git log --format="%h %s"')).toEqual(['git', 'log', '--format=%h %s']);
    expect(splitCommand("git log 'a b'")).toEqual(['git', 'log', 'a b']);
    expect(splitCommand('git log "oops')).toBeUndefined();
  });
});

describe('reviewGuardHooks', () => {
  it('denies through PreToolUse hookSpecificOutput and passes allowed calls through', async () => {
    const [matcher] = (reviewGuardHooks().PreToolUse as Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }>);
    await expect(
      matcher.hooks[0]({ tool_name: 'Bash', tool_input: { command: 'git branch -D main' } }),
    ).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    await expect(
      matcher.hooks[0]({ tool_name: 'Bash', tool_input: { command: 'git status' } }),
    ).resolves.toEqual({});
  });
});
