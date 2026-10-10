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
exports.StreamLogger = void 0;
exports.streamLogPathFor = streamLogPathFor;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const core = __importStar(require("@actions/core"));
/** JSONL stream log location for an agent run (uploaded later as an artifact). */
function streamLogPathFor(runId) {
    return path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `bugbit-stream-${runId}.jsonl`);
}
const THINKING_PREVIEW_CHARS = 200;
const ARGS_PREVIEW_CHARS = 120;
function truncate(text, max) {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}…`;
}
function summarizeArgs(args) {
    if (args === undefined) {
        return '';
    }
    try {
        const json = JSON.stringify(args);
        return truncate(json, ARGS_PREVIEW_CHARS);
    }
    catch {
        return '';
    }
}
class StreamLogger {
    assistantBuffer = '';
    initLogged = false;
    saveStreamLog;
    streamLogPath;
    streamLogHandle;
    constructor(options = {}) {
        this.saveStreamLog = options.saveStreamLog ?? false;
        this.streamLogPath = options.streamLogPath;
        if (this.saveStreamLog && this.streamLogPath) {
            this.streamLogHandle = fs.createWriteStream(this.streamLogPath, { flags: 'a' });
        }
    }
    async close() {
        this.flushAssistant();
        await new Promise((resolve, reject) => {
            if (!this.streamLogHandle) {
                resolve();
                return;
            }
            this.streamLogHandle.end((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    handleEvent(event) {
        if (this.saveStreamLog && this.streamLogHandle) {
            this.streamLogHandle.write(`${JSON.stringify(event)}\n`);
        }
        switch (event.type) {
            case 'assistant':
                this.handleAssistant(event);
                break;
            case 'tool_call':
                this.flushAssistant();
                this.handleToolCall(event);
                break;
            case 'thinking':
                this.flushAssistant();
                this.handleThinking(event);
                break;
            case 'status':
                this.flushAssistant();
                core.info(`[status] ${event.status ?? 'unknown'}`);
                break;
            case 'usage':
                this.flushAssistant();
                this.handleUsage(event);
                break;
            case 'system':
                this.handleSystem(event);
                break;
        }
    }
    handleAssistant(event) {
        const blocks = event.message?.content ?? [];
        for (const block of blocks) {
            if (block.type === 'text' && block.text) {
                this.assistantBuffer += block.text;
                const newlineIndex = this.assistantBuffer.lastIndexOf('\n');
                if (newlineIndex !== -1) {
                    const line = this.assistantBuffer.slice(0, newlineIndex + 1);
                    this.assistantBuffer = this.assistantBuffer.slice(newlineIndex + 1);
                    const trimmed = line.trimEnd();
                    if (trimmed.length > 0) {
                        core.info(trimmed);
                    }
                }
            }
        }
    }
    flushAssistant() {
        const text = this.assistantBuffer.trim();
        if (text.length > 0) {
            core.info(text);
        }
        this.assistantBuffer = '';
    }
    handleToolCall(event) {
        const name = event.name ?? 'unknown';
        const status = event.status ?? 'unknown';
        let line = `[tool] ${name} (${status})`;
        if (status === 'completed' || status === 'error') {
            const argsSummary = summarizeArgs(event.args);
            if (argsSummary) {
                line += ` ${argsSummary}`;
            }
        }
        core.info(line);
    }
    handleThinking(event) {
        const text = event.text?.trim();
        if (!text) {
            return;
        }
        core.info(`[thinking] ${truncate(text, THINKING_PREVIEW_CHARS)}`);
    }
    handleUsage(event) {
        const input = event.usage?.inputTokens ?? 0;
        const output = event.usage?.outputTokens ?? 0;
        core.info(`[usage] input=${input} output=${output}`);
    }
    handleSystem(event) {
        if (this.initLogged || event.subtype !== 'init') {
            return;
        }
        const modelId = event.model?.id ?? 'unknown';
        core.info(`[init] model=${modelId}`);
        this.initLogged = true;
    }
}
exports.StreamLogger = StreamLogger;
