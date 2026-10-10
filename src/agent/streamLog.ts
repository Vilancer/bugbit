import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@actions/core';

/** JSONL stream log location for an agent run (uploaded later as an artifact). */
export function streamLogPathFor(runId: string): string {
  return path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `bugbit-stream-${runId}.jsonl`);
}

/** Minimal shape of SDK stream events used for logging. */
export interface StreamEvent {
  type: string;
  status?: string;
  name?: string;
  call_id?: string;
  text?: string;
  subtype?: string;
  model?: { id?: string };
  usage?: { inputTokens?: number; outputTokens?: number };
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  args?: unknown;
}

export interface StreamLoggerOptions {
  saveStreamLog?: boolean;
  streamLogPath?: string;
}

const THINKING_PREVIEW_CHARS = 200;
const ARGS_PREVIEW_CHARS = 120;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

function summarizeArgs(args: unknown): string {
  if (args === undefined) {
    return '';
  }
  try {
    const json = JSON.stringify(args);
    return truncate(json, ARGS_PREVIEW_CHARS);
  } catch {
    return '';
  }
}

export class StreamLogger {
  private assistantBuffer = '';
  private initLogged = false;
  private readonly saveStreamLog: boolean;
  private readonly streamLogPath?: string;
  private streamLogHandle?: fs.WriteStream;

  constructor(options: StreamLoggerOptions = {}) {
    this.saveStreamLog = options.saveStreamLog ?? false;
    this.streamLogPath = options.streamLogPath;
    if (this.saveStreamLog && this.streamLogPath) {
      this.streamLogHandle = fs.createWriteStream(this.streamLogPath, { flags: 'a' });
    }
  }

  async close(): Promise<void> {
    this.flushAssistant();
    await new Promise<void>((resolve, reject) => {
      if (!this.streamLogHandle) {
        resolve();
        return;
      }
      this.streamLogHandle.end((error: NodeJS.ErrnoException | null | undefined) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  handleEvent(event: StreamEvent): void {
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

  private handleAssistant(event: StreamEvent): void {
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

  private flushAssistant(): void {
    const text = this.assistantBuffer.trim();
    if (text.length > 0) {
      core.info(text);
    }
    this.assistantBuffer = '';
  }

  private handleToolCall(event: StreamEvent): void {
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

  private handleThinking(event: StreamEvent): void {
    const text = event.text?.trim();
    if (!text) {
      return;
    }
    core.info(`[thinking] ${truncate(text, THINKING_PREVIEW_CHARS)}`);
  }

  private handleUsage(event: StreamEvent): void {
    const input = event.usage?.inputTokens ?? 0;
    const output = event.usage?.outputTokens ?? 0;
    core.info(`[usage] input=${input} output=${output}`);
  }

  private handleSystem(event: StreamEvent): void {
    if (this.initLogged || event.subtype !== 'init') {
      return;
    }
    const modelId = event.model?.id ?? 'unknown';
    core.info(`[init] model=${modelId}`);
    this.initLogged = true;
  }
}
