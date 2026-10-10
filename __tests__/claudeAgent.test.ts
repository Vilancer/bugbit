import type { SDKCustomTool } from '@cursor/sdk';
import {
  BUGBIT_MCP_SERVER,
  claudeAgentEnv,
  runClaudeAgent,
  zodShapeFromJsonSchema,
} from '../src/agent/claudeAgent';
import { loadClaudeAgentSdk, type ClaudeZod } from '../src/runtime/claudeSdk';

jest.mock('../src/runtime/claudeSdk', () => ({
  loadClaudeAgentSdk: jest.fn(),
}));

const mockLoad = loadClaudeAgentSdk as jest.MockedFunction<typeof loadClaudeAgentSdk>;

type Node = { kind: string; isOptional?: boolean; item?: Node; shape?: Record<string, Node> };

function fakeZod(): ClaudeZod {
  const node = (kind: string, extra: Partial<Node> = {}) => {
    const base: Node = { kind, ...extra };
    return { ...base, optional: (): Node => ({ ...base, isOptional: true }) };
  };
  return {
    string: () => node('string'),
    number: () => node('number'),
    boolean: () => node('boolean'),
    unknown: () => node('unknown'),
    array: (item) => node('array', { item: item as Node }),
    object: (shape) => node('object', { shape: shape as Record<string, Node> }),
  };
}

function mockSdk(messages: Array<Record<string, unknown>>) {
  const query = jest.fn().mockReturnValue(
    (async function* () {
      for (const message of messages) yield message;
    })(),
  );
  const tool = jest.fn((name, description, shape, handler) => ({ name, description, shape, handler }));
  const createSdkMcpServer = jest.fn((options) => ({ type: 'sdk', ...options }));
  mockLoad.mockResolvedValue({ query, tool, createSdkMcpServer, z: fakeZod() } as never);
  return { query, tool, createSdkMcpServer };
}

const tools: Record<string, SDKCustomTool> = {
  post_review: {
    description: 'post',
    inputSchema: {
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'object', properties: {} } } },
      required: ['findings'],
    },
    execute: async (args) => ({ posted: (args.findings as unknown[]).length }),
  },
};

const success = [
  { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5' },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 3 },
];

describe('zodShapeFromJsonSchema', () => {
  it('maps required/optional properties and nested arrays', () => {
    const shape = zodShapeFromJsonSchema(fakeZod(), {
      type: 'object',
      properties: {
        body: { type: 'string' },
        title: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['body', 'labels'],
    }) as Record<string, Node>;

    expect(shape.body).toMatchObject({ kind: 'string' });
    expect(shape.body.isOptional).toBeUndefined();
    expect(shape.title).toMatchObject({ kind: 'string', isOptional: true });
    expect(shape.labels).toMatchObject({ kind: 'array', item: { kind: 'string' } });
  });
});

describe('claudeAgentEnv', () => {
  it('scrubs action inputs and GitHub tokens and sets the OAuth token', () => {
    const env = claudeAgentEnv(
      { kind: 'oauth-token', token: 'sk-ant-oat01-x' },
      {
        PATH: '/usr/bin',
        'INPUT_GITHUB-TOKEN': 'ghs_secret',
        'INPUT_CLAUDE-CODE-OAUTH-TOKEN': 'sk-ant-oat01-x',
        GITHUB_TOKEN: 'ghs_secret',
        ACTIONS_RUNTIME_TOKEN: 'rt',
        ANTHROPIC_API_KEY: 'stale',
      },
    );
    expect(env).toEqual({ PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' });
  });

  it('uses ANTHROPIC_API_KEY for api-key auth', () => {
    expect(claudeAgentEnv({ kind: 'api-key', key: 'sk-ant-api' }, {})).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api',
    });
  });
});

describe('runClaudeAgent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs read-only with the bugbit MCP tools allowed and returns the session id', async () => {
    const { query, createSdkMcpServer } = mockSdk(success);

    const result = await runClaudeAgent(
      { kind: 'oauth-token', token: 't' },
      'review prompt',
      '/tmp/repo',
      tools,
      { model: 'claude-opus-5-5', systemPromptAppend: 'overlay' },
    );

    expect(result.runId).toBe('sess-1');
    expect(createSdkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: BUGBIT_MCP_SERVER }),
    );
    const { prompt, options } = query.mock.calls[0][0];
    expect(prompt).toBe('review prompt');
    expect(options).toMatchObject({
      cwd: '/tmp/repo',
      model: 'claude-opus-5-5',
      permissionMode: 'dontAsk',
      settingSources: [],
      strictMcpConfig: true,
      settings: expect.objectContaining({
        disableClaudeAiConnectors: true,
        attribution: { commit: '', pr: '', sessionUrl: false },
      }),
      skills: 'all',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'overlay' },
    });
    expect(options.allowedTools).toContain('mcp__bugbit__post_review');
    expect(options.allowedTools).not.toContain('Edit');
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(['Edit', 'Write', 'Read(//proc/**)']),
    );
  });

  it('bridges MCP calls to the bugbit tool and wraps the JSON result', async () => {
    const { tool } = mockSdk(success);
    await runClaudeAgent({ kind: 'api-key', key: 'k' }, 'p', '/tmp/repo', tools);

    const handler = tool.mock.calls[0][3];
    await expect(handler({ findings: [{}, {}] })).resolves.toEqual({
      content: [{ type: 'text', text: '{"posted":2}' }],
    });
  });

  it('resumes the session with the nudge until the pass is done', async () => {
    const { query } = mockSdk([]);
    query.mockImplementation(() =>
      (async function* () {
        yield* success;
      })(),
    );
    let calls = 0;
    const completion = { done: () => ++calls > 1, missing: 'a post_review call', nudge: 'finish it' };

    await runClaudeAgent({ kind: 'api-key', key: 'k' }, 'p', '/tmp/repo', tools, { completion });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toMatchObject({
      prompt: 'finish it',
      options: expect.objectContaining({ resume: 'sess-1' }),
    });
  });

  it('fails the run when the model never does the required call', async () => {
    const { query } = mockSdk([]);
    query.mockImplementation(() =>
      (async function* () {
        yield* success;
      })(),
    );
    const completion = { done: () => false, missing: 'a post_review call', nudge: 'finish it' };

    await expect(
      runClaudeAgent({ kind: 'api-key', key: 'k' }, 'p', '/tmp/repo', tools, { completion }),
    ).rejects.toThrow('finished without a post_review call after 2 follow-up(s)');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('throws when the run ends with an error result', async () => {
    mockSdk([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]);
    await expect(
      runClaudeAgent({ kind: 'api-key', key: 'k' }, 'p', '/tmp/repo', tools),
    ).rejects.toThrow('Claude agent run failed (error_during_execution): boom');
  });

  it('throws when the stream ends without a result', async () => {
    mockSdk([]);
    await expect(
      runClaudeAgent({ kind: 'api-key', key: 'k' }, 'p', '/tmp/repo', tools),
    ).rejects.toThrow('without a result');
  });
});

