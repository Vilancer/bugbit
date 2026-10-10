import type { SDKCustomTool } from '@cursor/sdk';
import * as core from '@actions/core';
import * as fs from 'node:fs';
import {
  loadClaudeAgentSdk,
  type ClaudeAgentSdk,
  type ClaudeMcpToolResult,
  type ClaudeZod,
} from '../runtime/claudeSdk';
import { AGENT_TIMEOUT_MESSAGE, AGENT_TIMEOUT_MS } from './runWait';
import { reviewGuardHooks } from './claudeGuard';
import type { PassCompletion } from './completion';
import { streamLogPathFor } from './streamLog';

export const BUGBIT_MCP_SERVER = 'bugbit';

/** Read-only tools the review agent may use without prompting (dontAsk denies everything else). */
const READ_ONLY_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  'Skill',
  'Agent',
  'Task',
  'TodoWrite',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git blame:*)',
  'Bash(git status:*)',
  'Bash(git rev-parse:*)',
  'Bash(git merge-base:*)',
  'Bash(git ls-files:*)',
];

// `//` = absolute path in permission rules: /proc/self/environ would expose the Claude credential.
const DENIED_TOOLS = [
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Read(//proc/**)',
  'Grep(//proc/**)',
  'Glob(//proc/**)',
  'Read(**/.git/config)',
  'Read(**/.env*)',
];

/** Env vars the agent subprocess must never see (action inputs carry secrets as INPUT_*). */
const SCRUBBED_ENV =
  /^(INPUT_|ACTIONS_RUNTIME_TOKEN$|ACTIONS_ID_TOKEN_REQUEST_|GITHUB_TOKEN$|GH_TOKEN$|CURSOR_API_KEY$|ANTHROPIC_API_KEY$|CLAUDE_CODE_OAUTH_TOKEN$)/;

export type ClaudeAuth =
  | { kind: 'oauth-token'; token: string }
  | { kind: 'api-key'; key: string };

export interface RunClaudeAgentOptions {
  model?: string;
  systemPromptAppend?: string;
  saveStreamLog?: boolean;
  /** Skill names visible to the session; [] hides all skills (describe pass). */
  skills?: string[];
  timeoutMs?: number;
  /** The pass's required outcome; the session is resumed with `nudge` until `done()` holds. */
  completion?: PassCompletion;
}

export interface RunClaudeAgentResult {
  runId: string;
  streamLogPath?: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

function zodFromJsonSchema(z: ClaudeZod, schema: JsonSchema, optional: boolean): unknown {
  let result: unknown;
  switch (schema.type) {
    case 'string':
      result = z.string();
      break;
    case 'number':
    case 'integer':
      result = z.number();
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'array':
      result = z.array(zodFromJsonSchema(z, schema.items ?? {}, false));
      break;
    case 'object':
      result = z.object(zodShapeFromJsonSchema(z, schema));
      break;
    default:
      result = z.unknown();
  }
  return optional ? (result as { optional(): unknown }).optional() : result;
}

/** Converts the flat JSON schemas bugbit tools declare into the zod raw shape the SDK `tool()` expects. */
export function zodShapeFromJsonSchema(z: ClaudeZod, schema: JsonSchema): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    shape[key] = zodFromJsonSchema(z, value, !required.has(key));
  }
  return shape;
}

export function createBugbitMcpServer(
  sdk: ClaudeAgentSdk,
  customTools: Record<string, SDKCustomTool>,
): unknown {
  const tools = Object.entries(customTools).map(([name, custom]) =>
    sdk.tool(
      name,
      custom.description ?? name,
      zodShapeFromJsonSchema(sdk.z, custom.inputSchema as JsonSchema),
      async (args): Promise<ClaudeMcpToolResult> => {
        try {
          const result = await custom.execute(args as never, undefined as never);
          return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          core.warning(`[bugbit] ${name} failed: ${message}`);
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      },
      // Keep bugbit tools in context instead of deferring them behind ToolSearch.
      { alwaysLoad: true },
    ),
  );
  return sdk.createSdkMcpServer({ name: BUGBIT_MCP_SERVER, version: '1.0.0', tools });
}

export function claudeAgentEnv(
  auth: ClaudeAuth,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || SCRUBBED_ENV.test(key)) continue;
    env[key] = value;
  }
  if (auth.kind === 'oauth-token') {
    env.CLAUDE_CODE_OAUTH_TOKEN = auth.token;
  } else {
    env.ANTHROPIC_API_KEY = auth.key;
  }
  return env;
}

function logMessage(message: Record<string, unknown>): void {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        core.info(`[init] model=${String(message.model ?? 'unknown')}`);
      }
      break;
    case 'assistant': {
      const content = (message.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          core.info(block.text.trim());
        } else if (block.type === 'tool_use') {
          core.info(`[tool] ${String(block.name)}`);
        }
      }
      break;
    }
    case 'result': {
      const usage = message.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      core.info(
        `[result] ${String(message.subtype)} turns=${String(message.num_turns ?? '?')} ` +
          `input=${usage?.input_tokens ?? 0} output=${usage?.output_tokens ?? 0}`,
      );
      break;
    }
  }
}

export async function runClaudeAgent(
  auth: ClaudeAuth,
  prompt: string,
  cwd: string,
  customTools: Record<string, SDKCustomTool>,
  options: RunClaudeAgentOptions = {},
): Promise<RunClaudeAgentResult> {
  core.setSecret(auth.kind === 'oauth-token' ? auth.token : auth.key);

  const sdk = await loadClaudeAgentSdk();
  const abortController = new AbortController();
  const timeoutMs = options.timeoutMs ?? AGENT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  const toolNames = Object.keys(customTools).map(
    (name) => `mcp__${BUGBIT_MCP_SERVER}__${name}`,
  );

  let streamLog: fs.WriteStream | undefined;
  let streamLogPath: string | undefined;
  let runId = 'unknown';

  try {
    const queryOptions = {
        cwd,
        model: options.model || undefined,
        abortController,
        env: claudeAgentEnv(auth),
        // Never load settings, hooks, or CLAUDE.md-driven config from the PR head checkout,
        // nor the token account's claude.ai connectors, synced skills, or plugins.
        settingSources: [],
        strictMcpConfig: true,
        settings: {
          disableClaudeAiConnectors: true,
          syncClaudeAiSkills: false,
          syncClaudeAiPlugins: false,
          // No "Generated with Claude Code" footer on auto-describe bodies or review text.
          attribution: { commit: '', pr: '', sessionUrl: false },
        },
        skills: options.skills ?? 'all',
        permissionMode: 'dontAsk',
        allowedTools: [...READ_ONLY_TOOLS, ...toolNames],
        disallowedTools: DENIED_TOOLS,
        mcpServers: { [BUGBIT_MCP_SERVER]: createBugbitMcpServer(sdk, customTools) },
        hooks: reviewGuardHooks(),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: options.systemPromptAppend },
        stderr: (data: string) => core.debug(`[claude] ${data.trimEnd()}`),
    };

    const completion = options.completion;
    let nextPrompt = prompt;
    for (let nudges = 0; ; nudges++) {
      // Follow-ups resume the same session, so the model keeps its findings so far.
      const run = sdk.query({
        prompt: nextPrompt,
        options: nudges === 0 ? queryOptions : { ...queryOptions, resume: runId },
      });

      let result: Record<string, unknown> | undefined;
      for await (const message of run) {
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          runId = String(message.session_id);
          core.info(`${nudges === 0 ? 'Started' : 'Resumed'} Claude session ${runId}`);
          if (options.saveStreamLog && !streamLog) {
            streamLogPath = streamLogPathFor(runId);
            streamLog = fs.createWriteStream(streamLogPath, { flags: 'a' });
          }
        }
        streamLog?.write(`${JSON.stringify(message)}\n`);
        logMessage(message);
        if (message.type === 'result') {
          result = message;
        }
      }

      if (!result) {
        throw new Error('Claude agent ended without a result message');
      }
      if (result.subtype !== 'success' || result.is_error) {
        const detail = Array.isArray(result.errors) ? `: ${result.errors.join('; ')}` : '';
        throw new Error(`Claude agent run failed (${String(result.subtype)})${detail}`);
      }

      if (!completion || completion.done()) break;
      if (nudges >= (completion.maxNudges ?? 2)) {
        throw new Error(`Claude agent finished without ${completion.missing} after ${nudges} follow-up(s)`);
      }
      core.warning(`Claude agent stopped without ${completion.missing}; asking it to finish (${nudges + 1})`);
      nextPrompt = completion.nudge;
    }

    core.info('Run completed with status=success');
    return { runId, streamLogPath };
  } catch (error) {
    if (timedOut) {
      throw new Error(AGENT_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (streamLog) {
      await new Promise<void>((resolve) => streamLog!.end(() => resolve()));
    }
  }
}
