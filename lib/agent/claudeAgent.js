"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUGBIT_MCP_SERVER = void 0;
exports.zodShapeFromJsonSchema = zodShapeFromJsonSchema;
exports.createBugbitMcpServer = createBugbitMcpServer;
exports.claudeAgentEnv = claudeAgentEnv;
exports.runClaudeAgent = runClaudeAgent;
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("node:fs"));
const claudeSdk_1 = require("../runtime/claudeSdk");
const runWait_1 = require("./runWait");
const claudeGuard_1 = require("./claudeGuard");
const streamLog_1 = require("./streamLog");
exports.BUGBIT_MCP_SERVER = 'bugbit';
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
const SCRUBBED_ENV = /^(INPUT_|ACTIONS_RUNTIME_TOKEN$|ACTIONS_ID_TOKEN_REQUEST_|GITHUB_TOKEN$|GH_TOKEN$|CURSOR_API_KEY$|ANTHROPIC_API_KEY$|CLAUDE_CODE_OAUTH_TOKEN$)/;
function zodFromJsonSchema(z, schema, optional) {
    let result;
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
    return optional ? result.optional() : result;
}
/** Converts the flat JSON schemas bugbit tools declare into the zod raw shape the SDK `tool()` expects. */
function zodShapeFromJsonSchema(z, schema) {
    const required = new Set(schema.required ?? []);
    const shape = {};
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
        shape[key] = zodFromJsonSchema(z, value, !required.has(key));
    }
    return shape;
}
function createBugbitMcpServer(sdk, customTools) {
    const tools = Object.entries(customTools).map(([name, custom]) => sdk.tool(name, custom.description ?? name, zodShapeFromJsonSchema(sdk.z, custom.inputSchema), async (args) => {
        try {
            const result = await custom.execute(args, undefined);
            return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            core.warning(`[bugbit] ${name} failed: ${message}`);
            return { content: [{ type: 'text', text: message }], isError: true };
        }
    }, 
    // Keep bugbit tools in context instead of deferring them behind ToolSearch.
    { alwaysLoad: true }));
    return sdk.createSdkMcpServer({ name: exports.BUGBIT_MCP_SERVER, version: '1.0.0', tools });
}
function claudeAgentEnv(auth, source = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined || SCRUBBED_ENV.test(key))
            continue;
        env[key] = value;
    }
    if (auth.kind === 'oauth-token') {
        env.CLAUDE_CODE_OAUTH_TOKEN = auth.token;
    }
    else {
        env.ANTHROPIC_API_KEY = auth.key;
    }
    return env;
}
function logMessage(message) {
    switch (message.type) {
        case 'system':
            if (message.subtype === 'init') {
                core.info(`[init] model=${String(message.model ?? 'unknown')}`);
            }
            break;
        case 'assistant': {
            const content = message.message?.content ?? [];
            for (const block of content) {
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                    core.info(block.text.trim());
                }
                else if (block.type === 'tool_use') {
                    core.info(`[tool] ${String(block.name)}`);
                }
            }
            break;
        }
        case 'result': {
            const usage = message.usage;
            core.info(`[result] ${String(message.subtype)} turns=${String(message.num_turns ?? '?')} ` +
                `input=${usage?.input_tokens ?? 0} output=${usage?.output_tokens ?? 0}`);
            break;
        }
    }
}
async function runClaudeAgent(auth, prompt, cwd, customTools, options = {}) {
    core.setSecret(auth.kind === 'oauth-token' ? auth.token : auth.key);
    const sdk = await (0, claudeSdk_1.loadClaudeAgentSdk)();
    const abortController = new AbortController();
    const timeoutMs = options.timeoutMs ?? runWait_1.AGENT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
    }, timeoutMs);
    const toolNames = Object.keys(customTools).map((name) => `mcp__${exports.BUGBIT_MCP_SERVER}__${name}`);
    let streamLog;
    let streamLogPath;
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
            mcpServers: { [exports.BUGBIT_MCP_SERVER]: createBugbitMcpServer(sdk, customTools) },
            hooks: (0, claudeGuard_1.reviewGuardHooks)(),
            systemPrompt: { type: 'preset', preset: 'claude_code', append: options.systemPromptAppend },
            stderr: (data) => core.debug(`[claude] ${data.trimEnd()}`),
        };
        const completion = options.completion;
        let nextPrompt = prompt;
        for (let nudges = 0;; nudges++) {
            // Follow-ups resume the same session, so the model keeps its findings so far.
            const run = sdk.query({
                prompt: nextPrompt,
                options: nudges === 0 ? queryOptions : { ...queryOptions, resume: runId },
            });
            let result;
            for await (const message of run) {
                if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
                    runId = String(message.session_id);
                    core.info(`${nudges === 0 ? 'Started' : 'Resumed'} Claude session ${runId}`);
                    if (options.saveStreamLog && !streamLog) {
                        streamLogPath = (0, streamLog_1.streamLogPathFor)(runId);
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
            if (!completion || completion.done())
                break;
            if (nudges >= (completion.maxNudges ?? 2)) {
                throw new Error(`Claude agent finished without ${completion.missing} after ${nudges} follow-up(s)`);
            }
            core.warning(`Claude agent stopped without ${completion.missing}; asking it to finish (${nudges + 1})`);
            nextPrompt = completion.nudge;
        }
        core.info('Run completed with status=success');
        return { runId, streamLogPath };
    }
    catch (error) {
        if (timedOut) {
            throw new Error(runWait_1.AGENT_TIMEOUT_MESSAGE);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
        if (streamLog) {
            await new Promise((resolve) => streamLog.end(() => resolve()));
        }
    }
}
