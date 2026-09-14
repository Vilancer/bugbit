import type { SDKCustomTool, SDKJsonValue } from '@cursor/sdk';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { dynamicImport } from '../runtime/dynamicImport';
import { resolveActionModuleUrl } from '../runtime/resolveActionModule';
import type { BugbitToolDeps, OpsDeps, PrefetchedPrData } from './types';

export type { BugbitToolDeps, PrefetchedPrData };

type OpsModule = {
  getPrContext: (deps: OpsDeps) => Promise<unknown>;
  getDiff: (deps: OpsDeps) => Promise<unknown>;
  postReview: (deps: OpsDeps, findings: unknown[]) => Promise<unknown>;
  postInlineComment: (
    deps: OpsDeps,
    input: { path: string; line: number; body: string },
  ) => Promise<unknown>;
  updatePrDescription: (
    deps: OpsDeps,
    input: { title?: string; body: string },
  ) => Promise<unknown>;
  setPrLabels: (deps: OpsDeps, input: { labels: string[] }) => Promise<unknown>;
};

const opsPromises = new Map<string, Promise<OpsModule>>();
const preflightPromises = new Map<string, Promise<PreflightModule>>();

type PreflightModule = {
  assertReviewPermissions: (deps: OpsDeps, octokit?: unknown) => Promise<void>;
  formatPermissionErrorMessage: (error: unknown) => string;
};

type EventModule = {
  assertPullRequestContext: (eventPath: string) => unknown;
};

const eventPromises = new Map<string, Promise<EventModule>>();

function loadOps(actionPath: string): Promise<OpsModule> {
  let promise = opsPromises.get(actionPath);
  if (!promise) {
    promise = dynamicImport<OpsModule>(resolveActionModuleUrl(actionPath, 'operations'));
    opsPromises.set(actionPath, promise);
  }
  return promise;
}

function loadPreflight(actionPath: string): Promise<PreflightModule> {
  let promise = preflightPromises.get(actionPath);
  if (!promise) {
    promise = dynamicImport<PreflightModule>(
      resolveActionModuleUrl(actionPath, 'preflight'),
    );
    preflightPromises.set(actionPath, promise);
  }
  return promise;
}

function loadEventModule(actionPath: string): Promise<EventModule> {
  let promise = eventPromises.get(actionPath);
  if (!promise) {
    const eventUrl = pathToFileURL(
      path.join(actionPath, 'scripts', 'lib', 'event.mjs'),
    ).href;
    promise = dynamicImport<EventModule>(eventUrl);
    eventPromises.set(actionPath, promise);
  }
  return promise;
}

async function assertPullRequestContext(deps: BugbitToolDeps): Promise<void> {
  const { assertPullRequestContext: assertContext } = await loadEventModule(deps.actionPath);
  assertContext(deps.eventPath);
}

function toOpsDeps(deps: BugbitToolDeps): OpsDeps {
  return {
    token: deps.githubToken,
    eventPath: deps.eventPath,
    repository: deps.repository,
    postCleanSummary: deps.postCleanSummary,
    cleanSummaryBody: deps.cleanSummaryBody,
    autoDescribe: deps.autoDescribe,
    describeLabels: deps.describeLabels,
  };
}

export async function checkReviewPermissions(deps: BugbitToolDeps): Promise<void> {
  try {
    await assertPullRequestContext(deps);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const { assertReviewPermissions, formatPermissionErrorMessage } = await loadPreflight(
    deps.actionPath,
  );

  core.info('Checking GitHub token permissions for PR review…');
  try {
    await assertReviewPermissions(toOpsDeps(deps));
  } catch (error) {
    throw new Error(formatPermissionErrorMessage(error));
  }
  core.info('GitHub token permissions OK');
}

export function copyPermissionsToWorkspace(actionPath: string, cwd: string): void {
  const src = path.resolve(actionPath, '.cursor', 'permissions.json');
  const dst = path.resolve(cwd, '.cursor', 'permissions.json');

  if (!fs.existsSync(src)) {
    core.warning(`permissions.json not found at ${src}; shell restrictions may not apply`);
    return;
  }

  if (src === dst) {
    return;
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

export async function prefetchPrData(deps: BugbitToolDeps): Promise<PrefetchedPrData> {
  const ops = await loadOps(deps.actionPath);
  const toolDeps = toOpsDeps(deps);

  core.info('Prefetching PR context and diff…');
  const context = await ops.getPrContext(toolDeps);
  const diff = await ops.getDiff(toolDeps);
  const typedDiff = diff as { files?: unknown[]; diffMode?: string };
  const fileCount = Array.isArray(typedDiff.files) ? typedDiff.files.length : 0;
  const diffMode = typeof typedDiff.diffMode === 'string' ? typedDiff.diffMode : 'full';
  core.info(`Prefetched diff: ${fileCount} changed file(s) (diffMode=${diffMode})`);
  return { context, diff };
}

export function isForkPullRequest(eventPath: string): boolean {
  if (!eventPath) return false;
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) return false;
  return pr.head?.repo?.full_name !== pr.base?.repo?.full_name;
}

export type BugbitToolPass = 'describe' | 'review';

export function createBugbitTools(
  deps: BugbitToolDeps,
  pass: BugbitToolPass = 'review',
): Record<string, SDKCustomTool> {
  const toolDeps = toOpsDeps(deps);

  const get_pr_context: SDKCustomTool = {
    description:
      'Returns PR number, title, body, head/base branch names, and commit SHAs for the current pull_request event.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      core.info('[bugbit] get_pr_context called');
      const ops = await loadOps(deps.actionPath);
      return (await ops.getPrContext(toolDeps)) as SDKJsonValue;
    },
  };

  const set_pr_labels: SDKCustomTool = {
    description:
      'Applies labels to the PR (issues API). Creates missing labels. Requires issues: write permission.',
    inputSchema: {
      type: 'object',
      properties: {
        labels: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['labels'],
      additionalProperties: false,
    },
    execute: async (args) => {
      core.info(`[bugbit] set_pr_labels called with ${(args.labels as string[]).length} label(s)`);
      const ops = await loadOps(deps.actionPath);
      const result = await ops.setPrLabels(toolDeps, {
        labels: args.labels as string[],
      });
      return result as SDKJsonValue;
    },
  };

  const get_diff: SDKCustomTool = {
    description:
      'Returns changed files for the current PR with diffMode (full | hunk_ranges | paths_only). Prefer prefetched data; use when missing.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      core.info('[bugbit] get_diff called');
      const ops = await loadOps(deps.actionPath);
      return (await ops.getDiff(toolDeps)) as SDKJsonValue;
    },
  };

  const post_review: SDKCustomTool = {
    description:
      'Posts multiple inline comments as one PR review; prefer this over repeated post_inline_comment calls. Pass an empty findings array when there are no issues (may post an LGTM summary when configured).',
    inputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              mode: { type: 'string' },
              path: { type: 'string' },
              line: { type: 'number' },
              body: { type: 'string' },
            },
            required: ['mode', 'path', 'line', 'body'],
            additionalProperties: false,
          },
        },
      },
      required: ['findings'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const findings = args.findings as unknown[];
      core.info(`[bugbit] post_review called with ${findings.length} finding(s)`);
      const ops = await loadOps(deps.actionPath);
      const result = (await ops.postReview(toolDeps, findings)) as SDKJsonValue;
      core.info('[bugbit] post_review completed');
      return result;
    },
  };

  const post_inline_comment: SDKCustomTool = {
    description:
      'Posts a single inline comment on a specific file and line in the PR diff.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' },
        body: { type: 'string' },
      },
      required: ['path', 'line', 'body'],
      additionalProperties: false,
    },
    execute: async (args) => {
      core.info(`[bugbit] post_inline_comment called for ${args.path}:${args.line}`);
      const ops = await loadOps(deps.actionPath);
      const result = await ops.postInlineComment(toolDeps, {
        path: args.path as string,
        line: args.line as number,
        body: args.body as string,
      });
      return result as SDKJsonValue;
    },
  };

  const update_pr_description: SDKCustomTool = {
    description:
      'Appends an auto-describe section after the developer PR body (replaces prior auto-describe on re-run). Optionally updates title. Requires pull-requests: write.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    execute: async (args) => {
      core.info('[bugbit] update_pr_description called');
      const ops = await loadOps(deps.actionPath);
      const result = await ops.updatePrDescription(toolDeps, {
        body: args.body as string,
        ...(args.title ? { title: args.title as string } : {}),
      });
      return result as SDKJsonValue;
    },
  };

  if (pass === 'describe') {
    return { get_pr_context, get_diff, update_pr_description, set_pr_labels };
  }

  return { get_pr_context, get_diff, post_review, post_inline_comment };
}
