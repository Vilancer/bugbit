import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as core from '@actions/core';
import { dynamicImport } from './dynamicImport';

/**
 * Pinned Claude Agent SDK. It is installed on the runner at run time instead of
 * bundled: the package is ESM-only and ships a ~250MB native Claude Code binary
 * per platform, which ncc cannot (and should not) inline into dist/index.js.
 */
export const CLAUDE_AGENT_SDK_VERSION = '0.3.296';

const PEER_PACKAGES = ['zod@4.6.5', '@modelcontextprotocol/sdk@1.32.1', '@anthropic-ai/sdk@0.133.0'];

/** Re-exports the SDK and zod from one ESM graph so tool schemas share the SDK's zod instance. */
const ENTRY_SOURCE = [
  "export { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';",
  "export { z } from 'zod';",
  '',
].join('\n');

/** Minimal structural types for the parts of the SDK bugbit uses (the SDK is not a build dependency). */
export interface ClaudeZod {
  string(): unknown;
  number(): unknown;
  boolean(): unknown;
  unknown(): unknown;
  array(item: unknown): unknown;
  object(shape: Record<string, unknown>): unknown;
}

export interface ClaudeMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type ClaudeQuery = AsyncIterable<Record<string, unknown>>;

export interface ClaudeAgentSdk {
  query(params: { prompt: string; options: Record<string, unknown> }): ClaudeQuery;
  tool(
    name: string,
    description: string,
    shape: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<ClaudeMcpToolResult>,
    extras?: { alwaysLoad?: boolean },
  ): unknown;
  createSdkMcpServer(options: { name: string; version?: string; tools: unknown[] }): unknown;
  z: ClaudeZod;
}

export function claudeSdkInstallDir(): string {
  return path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    `bugbit-claude-agent-sdk-${CLAUDE_AGENT_SDK_VERSION}`,
  );
}

export function installClaudeAgentSdk(installDir: string = claudeSdkInstallDir()): string {
  const entryPath = path.join(installDir, 'bugbit-entry.mjs');
  const sdkPackageJson = path.join(
    installDir,
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'package.json',
  );

  if (!fs.existsSync(sdkPackageJson)) {
    core.info(`Installing @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION} into ${installDir}…`);
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(
      path.join(installDir, 'package.json'),
      JSON.stringify({ name: 'bugbit-claude-runtime', private: true, type: 'module' }),
    );
    execFileSync(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--loglevel=error',
        `@anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION}`,
        ...PEER_PACKAGES,
      ],
      { cwd: installDir, stdio: 'inherit' },
    );
  }

  fs.writeFileSync(entryPath, ENTRY_SOURCE);
  return entryPath;
}

let sdkPromise: Promise<ClaudeAgentSdk> | undefined;

async function importClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  try {
    return await dynamicImport<ClaudeAgentSdk>(pathToFileURL(installClaudeAgentSdk()).href);
  } catch (error) {
    sdkPromise = undefined; // let a later call retry the install
    throw error;
  }
}

export function loadClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  sdkPromise ??= importClaudeAgentSdk();
  return sdkPromise;
}
