import { Agent } from '@cursor/sdk';
import * as core from '@actions/core';
import type { SDKCustomTool } from '@cursor/sdk';
import { runAgent } from '../src/agent/cursorAgent';

jest.mock('@cursor/sdk', () => ({
  Agent: {
    create: jest.fn(),
  },
  CursorAgentError: class CursorAgentError extends Error {
    isRetryable = false;
  },
}));

const mockCreate = Agent.create as jest.MockedFunction<typeof Agent.create>;

function makeCustomTools(): Record<string, SDKCustomTool> {
  return {
    get_pr_context: {
      description: 'test',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({}),
    },
  };
}

function mockAgentSuccess(
  waitResult: { status: string; id: string } = { status: 'completed', id: 'run-1' },
  streamEvents: Array<Record<string, unknown>> = [],
): void {
  mockCreate.mockResolvedValue({
    agentId: 'agent-1',
    send: jest.fn().mockResolvedValue({
      id: 'run-1',
      stream: async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      },
      wait: jest.fn().mockResolvedValue(waitResult),
    }),
    [Symbol.asyncDispose]: async () => {},
  } as never);
}

describe('runAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('passes customTools to Agent.create under local.customTools', async () => {
    const customTools = makeCustomTools();
    mockAgentSuccess();

    const result = await runAgent('api-key', 'composer-2.5', 'review prompt', '/tmp/repo', customTools);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        local: expect.objectContaining({
          customTools,
          cwd: '/tmp/repo',
          autoReview: false,
          settingSources: [],
        }),
      }),
    );
    expect(result.runId).toBe('run-1');
  });

  it('masks apiKey with core.setSecret before logging', async () => {
    const customTools = makeCustomTools();
    mockAgentSuccess();

    await runAgent('secret-api-key', 'composer-2.5', 'prompt', '/tmp/repo', customTools);

    expect(core.setSecret).toHaveBeenCalledWith('secret-api-key');
    const setSecretOrder = (core.setSecret as jest.Mock).mock.invocationCallOrder[0];
    const infoOrder = (core.info as jest.Mock).mock.invocationCallOrder[0];
    expect(setSecretOrder).toBeLessThan(infoOrder);
  });

  it('formats stream events instead of logging raw JSON', async () => {
    const customTools = makeCustomTools();
    mockAgentSuccess({ status: 'completed', id: 'run-1' }, [
      {
        type: 'tool_call',
        name: 'get_pr_context',
        status: 'running',
      },
    ]);

    await runAgent('api-key', 'composer-2.5', 'prompt', '/tmp/repo', customTools);

    expect(core.info).toHaveBeenCalledWith('[tool] get_pr_context (running)');
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('"type":"tool_call"'));
  });

  it('returns streamLogPath when saveStreamLog is enabled', async () => {
    const customTools = makeCustomTools();
    mockAgentSuccess();

    const result = await runAgent('api-key', 'composer-2.5', 'prompt', '/tmp/repo', customTools, {
      saveStreamLog: true,
    });

    expect(result.streamLogPath).toContain('bugbit-stream-run-1.jsonl');
  });

  it('logs when waiting for run completion after stream ends', async () => {
    const customTools = makeCustomTools();
    mockAgentSuccess();

    await runAgent('api-key', 'composer-2.5', 'prompt', '/tmp/repo', customTools);

    expect(core.info).toHaveBeenCalledWith('Stream ended; waiting for run completion…');
    expect(core.info).toHaveBeenCalledWith('Run completed with status=completed');
  });

  it('rejects when run.wait exceeds the agent timeout', async () => {
    const customTools = makeCustomTools();

    mockCreate.mockResolvedValue({
      agentId: 'agent-1',
      send: jest.fn().mockResolvedValue({
        id: 'run-1',
        stream: async function* () {},
        wait: jest.fn().mockReturnValue(new Promise(() => {})),
        cancel: jest.fn().mockResolvedValue(undefined),
      }),
      [Symbol.asyncDispose]: async () => {},
    } as never);

    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn: TimerHandler, _ms?: number) => {
        if (typeof fn === 'function') {
          fn();
        }
        return 0 as unknown as NodeJS.Timeout;
      });

    await expect(
      runAgent('api-key', 'composer-2.5', 'prompt', '/tmp/repo', customTools),
    ).rejects.toThrow('Agent timed out after 45 minutes');

    setTimeoutSpy.mockRestore();
  });

  it('sends the nudge as a follow-up on the same agent until the pass is done', async () => {
    const run = (id: string) => ({
      id,
      stream: async function* () {},
      wait: jest.fn().mockResolvedValue({ status: 'completed', id }),
    });
    const send = jest.fn().mockResolvedValueOnce(run('run-1')).mockResolvedValueOnce(run('run-2'));
    mockCreate.mockResolvedValue({ agentId: 'agent-1', send, [Symbol.asyncDispose]: async () => {} } as never);
    let checks = 0;

    const result = await runAgent('k', 'composer-2.5', 'p', '/tmp/repo', makeCustomTools(), {
      completion: { done: () => ++checks > 1, missing: 'a post_review call', nudge: 'finish it' },
    });

    expect(send).toHaveBeenNthCalledWith(2, 'finish it');
    expect(result.runId).toBe('run-1');
  });

  it('fails when the agent never does the required call', async () => {
    const send = jest.fn().mockImplementation(async () => ({
      id: 'run-x',
      stream: async function* () {},
      wait: jest.fn().mockResolvedValue({ status: 'completed', id: 'run-x' }),
    }));
    mockCreate.mockResolvedValue({ agentId: 'agent-1', send, [Symbol.asyncDispose]: async () => {} } as never);

    await expect(
      runAgent('k', 'composer-2.5', 'p', '/tmp/repo', makeCustomTools(), {
        completion: { done: () => false, missing: 'a post_review call', nudge: 'finish it' },
      }),
    ).rejects.toThrow('finished without a post_review call after 2 follow-up(s)');
    expect(send).toHaveBeenCalledTimes(3);
  });
});
