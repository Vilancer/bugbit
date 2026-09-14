import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SDKCustomTool } from '@cursor/sdk';

jest.mock('../src/runtime/dynamicImport');

const mockOpsSource = `
export async function getPrContext() {
  return { number: 42, headRef: 'feat', baseRef: 'main', headSha: 'abc', baseSha: 'def' };
}
export async function getDiff() {
  return { files: [{ path: 'src/a.ts', status: 'modified' }] };
}
export async function postReview(_deps, findings) {
  if (!findings.length) {
    return { posted: [], reviewId: 7, cleanSummary: true };
  }
  return { posted: findings, reviewId: null };
}
export async function postInlineComment(_deps, input) {
  if (input.path === 'invalid.ts') {
    return { error: { code: 'INVALID_PATH', message: 'path not in diff' } };
  }
  return { posted: true, path: input.path, line: input.line };
}
export async function updatePrDescription(_deps, input) {
  return { updated: true, body: input.body };
}
`;

const REVIEW_TOOL_NAMES = [
  'get_pr_context',
  'get_diff',
  'post_review',
  'post_inline_comment',
] as const;

const DESCRIBE_TOOL_NAMES = [
  'get_pr_context',
  'get_diff',
  'update_pr_description',
] as const;

function setupActionPath(): string {
  const actionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-action-'));
  const opsDir = path.join(actionPath, 'scripts', 'lib');
  fs.mkdirSync(opsDir, { recursive: true });
  fs.writeFileSync(path.join(opsDir, 'operations.mjs'), mockOpsSource);
  return actionPath;
}

describe('createBugbitTools', () => {
  let actionPath: string;
  let createBugbitTools: typeof import('../src/github/tools').createBugbitTools;
  let copyPermissionsToWorkspace: typeof import('../src/github/tools').copyPermissionsToWorkspace;

  beforeEach(async () => {
    jest.resetModules();
    actionPath = setupActionPath();
    const mod = await import('../src/github/tools');
    createBugbitTools = mod.createBugbitTools;
    copyPermissionsToWorkspace = mod.copyPermissionsToWorkspace;
  });

  afterEach(() => {
    fs.rmSync(actionPath, { recursive: true, force: true });
  });

  it('returns custom tools with schema and execute handlers', () => {
    const tools = createBugbitTools({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    expect(Object.keys(tools).sort()).toEqual([...REVIEW_TOOL_NAMES].sort());

    for (const name of REVIEW_TOOL_NAMES) {
      const tool = tools[name] as SDKCustomTool;
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('scopes describe-pass tools to description updates only', () => {
    const tools = createBugbitTools(
      {
        githubToken: 'test-token',
        eventPath: '/tmp/event.json',
        repository: 'owner/repo',
        actionPath,
      },
      'describe',
    );

    expect(Object.keys(tools).sort()).toEqual([...DESCRIBE_TOOL_NAMES].sort());
    expect(tools.post_review).toBeUndefined();
    expect(tools.post_inline_comment).toBeUndefined();
  });

  it('does not expose token fields in tool input schemas', () => {
    const tools = createBugbitTools({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    for (const name of REVIEW_TOOL_NAMES) {
      const schema = tools[name].inputSchema as {
        properties?: Record<string, unknown>;
      };
      const props = Object.keys(schema.properties ?? {});
      expect(props).not.toContain('token');
      expect(props).not.toContain('github_token');
    }
  });

  it('get_pr_context.execute returns PR fields from operations mock', async () => {
    const tools = createBugbitTools({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    const result = await tools.get_pr_context.execute({}, {});
    expect(result).toEqual({
      number: 42,
      headRef: 'feat',
      baseRef: 'main',
      headSha: 'abc',
      baseSha: 'def',
    });
  });

  it('post_review.execute returns posted array and null reviewId', async () => {
    const tools = createBugbitTools({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    const result = await tools.post_review.execute({ findings: [] }, {});
    expect(result).toEqual({ posted: [], reviewId: 7, cleanSummary: true });
  });

  it('post_inline_comment.execute returns structured error for invalid path', async () => {
    const tools = createBugbitTools({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    const result = await tools.post_inline_comment.execute(
      { path: 'invalid.ts', line: 1, body: 'issue' },
      {},
    );
    expect(result).toEqual({
      error: { code: 'INVALID_PATH', message: 'path not in diff' },
    });
  });

  it('update_pr_description.execute is available on the describe pass', async () => {
    const tools = createBugbitTools(
      {
        githubToken: 'test-token',
        eventPath: '/tmp/event.json',
        repository: 'owner/repo',
        actionPath,
      },
      'describe',
    );

    const result = await tools.update_pr_description.execute({ body: '### Description' }, {});
    expect(result).toEqual({ updated: true, body: '### Description' });
  });
});

describe('prefetchPrData', () => {
  let actionPath: string;

  beforeEach(async () => {
    jest.resetModules();
    actionPath = setupActionPath();
  });

  afterEach(() => {
    fs.rmSync(actionPath, { recursive: true, force: true });
  });

  it('returns prefetched context and diff', async () => {
    const { prefetchPrData } = await import('../src/github/tools');

    const result = await prefetchPrData({
      githubToken: 'test-token',
      eventPath: '/tmp/event.json',
      repository: 'owner/repo',
      actionPath,
    });

    expect(result.context).toEqual({
      number: 42,
      headRef: 'feat',
      baseRef: 'main',
      headSha: 'abc',
      baseSha: 'def',
    });
    expect(result.diff).toEqual({ files: [{ path: 'src/a.ts', status: 'modified' }] });
  });
});

describe('copyPermissionsToWorkspace', () => {
  let actionPath: string;
  let workspace: string;
  let copyPermissionsToWorkspace: typeof import('../src/github/tools').copyPermissionsToWorkspace;

  beforeEach(async () => {
    jest.resetModules();
    actionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-perms-src-'));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-perms-dst-'));

    fs.mkdirSync(path.join(actionPath, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(actionPath, '.cursor', 'permissions.json'),
      '{"mcpAllowlist":["custom-user-tools:*"]}',
    );

    const mod = await import('../src/github/tools');
    copyPermissionsToWorkspace = mod.copyPermissionsToWorkspace;
  });

  afterEach(() => {
    fs.rmSync(actionPath, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('copies permissions.json into workspace .cursor directory', () => {
    copyPermissionsToWorkspace(actionPath, workspace);

    const dst = path.join(workspace, '.cursor', 'permissions.json');
    expect(fs.existsSync(dst)).toBe(true);
    expect(fs.readFileSync(dst, 'utf8')).toContain('custom-user-tools');
  });

  it('no-ops when action path equals workspace', () => {
    copyPermissionsToWorkspace(actionPath, actionPath);

    const dst = path.join(actionPath, '.cursor', 'permissions.json');
    expect(fs.readFileSync(dst, 'utf8')).toContain('custom-user-tools');
  });
});
