import { Agent, CursorAgentError, type SDKCustomTool } from '@cursor/sdk';
import * as core from '@actions/core';
import { assertWithinDeadline, AGENT_TIMEOUT_MS, remainingMs, waitForRunWithHeartbeat } from './runWait';
import type { PassCompletion } from './completion';
import { StreamLogger, streamLogPathFor, type StreamEvent } from './streamLog';

export { AGENT_TIMEOUT_MS } from './runWait';

export interface RunAgentOptions {
  saveStreamLog?: boolean;
  /** The pass's required outcome; the agent gets `nudge` as a follow-up until `done()` holds. */
  completion?: PassCompletion;
}

export interface RunAgentResult {
  runId: string;
  streamLogPath?: string;
}

export async function runAgent(
  apiKey: string,
  model: string,
  prompt: string,
  cwd: string,
  customTools: Record<string, SDKCustomTool>,
  options: RunAgentOptions = {},
): Promise<RunAgentResult> {
  core.setSecret(apiKey);

  const deadlineMs = Date.now() + AGENT_TIMEOUT_MS;
  let logger: StreamLogger | undefined;
  let activeRun: { cancel: () => Promise<void> } | undefined;

  try {
    assertWithinDeadline(deadlineMs);

    // permissions.json copied to cwd/.cursor/ is best-effort for Shell exploration; PR ops use customTools.
    await using agent = await Agent.create({
      apiKey,
      model: { id: model },
      local: {
        cwd,
        customTools,
        autoReview: false,
        // Never load rules, MCP servers or settings from the PR head checkout. (No sandboxOptions:
        // the Cursor SDK refuses to start with it on GitHub-hosted runners.)
        settingSources: [],
      },
    });

    const firstRun = await agent.send(prompt);
    core.info(`Started run ${firstRun.id} (agent ${agent.agentId})`);

    const streamLogPath = options.saveStreamLog ? streamLogPathFor(firstRun.id) : undefined;

    logger = new StreamLogger({
      saveStreamLog: options.saveStreamLog,
      streamLogPath,
    });

    const completion = options.completion;
    let run = firstRun;
    for (let nudges = 0; ; nudges++) {
      activeRun = run;
      for await (const event of run.stream()) {
        assertWithinDeadline(deadlineMs);
        logger.handleEvent(event as StreamEvent);
      }

      const result = await waitForRunWithHeartbeat(run, remainingMs(deadlineMs));

      if (result.status === 'error') {
        throw new Error(`Agent run failed: ${result.id}`);
      }
      if (result.status === 'cancelled') {
        throw new Error(`Agent run cancelled: ${result.id}`);
      }

      core.info(`Run completed with status=${result.status}`);

      if (!completion || completion.done()) break;
      if (nudges >= (completion.maxNudges ?? 2)) {
        throw new Error(`Cursor agent finished without ${completion.missing} after ${nudges} follow-up(s)`);
      }
      core.warning(`Cursor agent stopped without ${completion.missing}; asking it to finish (${nudges + 1})`);
      // A follow-up on the same agent keeps its conversation and findings so far.
      run = await agent.send(completion.nudge);
    }

    await logger.close();

    return {
      runId: firstRun.id,
      streamLogPath,
    };
  } catch (error) {
    await activeRun?.cancel?.().catch(() => {});
    await logger?.close().catch(() => {});
    if (error instanceof CursorAgentError) {
      throw new Error(
        `Agent startup failed: ${error.message} (retryable=${error.isRetryable})`,
      );
    }
    throw error;
  }
}
