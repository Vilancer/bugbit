import * as core from '@actions/core';
import * as path from 'path';
import { runAgent } from './agent/cursorAgent';
import { runClaudeAgent } from './agent/claudeAgent';
import { DESCRIBE_NUDGE, REVIEW_NUDGE, requireToolCall } from './agent/completion';
import {
  artifactUploadErrorMessage,
  streamLogArtifactName,
  uploadStreamLogArtifact,
} from './runtime/artifactUpload';
import { resolveActionPath } from './runtime/actionPath';
import { assertRepoCheckedOut } from './runtime/checkCheckout';
import {
  buildClaudeSkillPrompt,
  buildDescribePrompt,
  buildSkillPrompt,
  parseReviewLevel,
  parseReviewModes,
  validateReviewModes,
} from './prompts/reviewModes';
import {
  checkReviewPermissions,
  copyPermissionsToWorkspace,
  createBugbitTools,
  isForkPullRequest,
  prefetchPrData,
} from './github/tools';
import type { PrefetchedPrData } from './github/types';
import { prepareBaseRef, readPullRequestRefs } from './runtime/prepareBaseRef';
import { parseProvider, resolveClaudeAuth } from './runtime/provider';
import { scrubSecretEnv } from './runtime/secretEnv';
import { githubTokenForms } from './github/redact';
import { resolveEvent } from './runtime/resolveEvent';
import { bootstrapRipgrep } from './runtime/sdkBootstrap';

const AUTO_DESCRIBE_START = '<!-- bugbit-auto-describe:start -->';
const AUTO_DESCRIBE_END = '<!-- bugbit-auto-describe:end -->';

function hasPrefetchedAutoDescribe(prefetched: PrefetchedPrData): boolean {
  const context = prefetched.context;
  if (!context || typeof context !== 'object') {
    return false;
  }
  const body = (context as { body?: unknown }).body;
  if (typeof body !== 'string') {
    return false;
  }
  return body.includes(AUTO_DESCRIBE_START) && body.includes(AUTO_DESCRIBE_END);
}

async function run(): Promise<void> {
  try {
    bootstrapRipgrep();

    const cwd = process.cwd();
    assertRepoCheckedOut(cwd);

    const provider = parseProvider(core.getInput('provider'));
    const apiKey = provider === 'cursor' ? core.getInput('cursor-api-key') : '';
    if (provider === 'cursor' && !apiKey) {
      throw new Error('provider: cursor needs the cursor-api-key input.');
    }
    const claudeAuth =
      provider === 'claude'
        ? resolveClaudeAuth(
            core.getInput('claude-code-oauth-token'),
            core.getInput('anthropic-api-key'),
          )
        : undefined;
    const githubToken = core.getInput('github-token', { required: true });
    core.setSecret(githubToken);

    // Empty model on claude means Claude Code's default model for the account.
    const model = core.getInput('model') || (provider === 'cursor' ? 'composer-2.5' : '');
    const reviewLevel = parseReviewLevel(core.getInput('review-level'));
    if (reviewLevel && provider === 'cursor') {
      core.warning('review-level only applies to provider: claude (/code-review levels); ignoring it.');
    }
    const modesInput = core.getInput('review-modes');
    const saveStreamLog = core.getBooleanInput('save-stream-log');
    const postCleanSummaryInput = core.getInput('post-clean-summary');
    const postCleanSummary =
      postCleanSummaryInput === '' ? true : core.getBooleanInput('post-clean-summary');
    const cleanSummaryBody =
      core.getInput('clean-summary-body') ||
      '## bugbit: LGTM — no findings\n\nNo issues reported on this diff.';
    const autoDescribe =
      (core.getInput('auto-describe') || 'false').toString().toLowerCase() === 'true';
    const describeLabelsRaw = (core.getInput('describe-labels') || '').trim();
    const describeLabels = describeLabelsRaw
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);

    if (autoDescribe) {
      core.warning(
        'auto-describe infers PR labels — consumer job must include permissions: issues: write and pull-requests: write',
      );
    }

    const prNumber = core.getInput('pr-number');
    // All inputs are read; agents must not find credentials in the environment.
    const withActionsRuntime = scrubSecretEnv();
    const secrets = [
      ...githubTokenForms(githubToken),
      apiKey,
      claudeAuth?.kind === 'oauth-token' ? claudeAuth.token : (claudeAuth?.key ?? ''),
    ].filter(Boolean);
    secrets.forEach((secret) => core.setSecret(secret));
    const rawEventPath = process.env.GITHUB_EVENT_PATH ?? '';
    const repository = process.env.GITHUB_REPOSITORY ?? '';

    const eventPath = await resolveEvent({
      token: githubToken,
      repository,
      eventPath: rawEventPath,
      prNumber: prNumber || undefined,
    });

    if (isForkPullRequest(eventPath)) {
      core.setFailed(
        'bugbit cannot post review comments on pull requests from forks: ' +
          'GITHUB_TOKEN is read-only for fork PRs. ' +
          'See bugbit documentation (DOCS-04) for workarounds.',
      );
      return;
    }

    const actionPath = resolveActionPath(cwd);

    const toolDeps = {
      githubToken,
      eventPath,
      repository,
      actionPath,
      postCleanSummary,
      cleanSummaryBody,
      autoDescribe,
      describeLabels,
      redact: secrets,
    };

    if (saveStreamLog) {
      core.info(
        'save-stream-log enabled — consumer workflow must include actions: write',
      );
    }

    try {
      await checkReviewPermissions(toolDeps);
    } catch (error) {
      core.setFailed(error instanceof Error ? error.message : String(error));
      return;
    }

    if (provider === 'cursor') {
      // Cursor-only shell allowlist; on Claude it would just be an untracked file the model reads.
      copyPermissionsToWorkspace(actionPath, cwd);
    }
    const promptsDir = path.join(actionPath, 'prompts');

    const prefetched = await prefetchPrData(toolDeps);

    const reviewModes = parseReviewModes(modesInput);
    const alreadyDescribed = hasPrefetchedAutoDescribe(prefetched);
    const runDescribe = autoDescribe && !alreadyDescribed;
    const runReview = reviewModes.length > 0;

    if (runReview) {
      try {
        validateReviewModes(reviewModes);
      } catch (error) {
        core.setFailed(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (autoDescribe && alreadyDescribed) {
      core.info(
        'Skipping auto-describe: PR body already has a bugbit auto-describe section. Review will still run.',
      );
    }

    if (!runDescribe && !runReview) {
      core.setFailed(
        'bugbit has nothing to do: auto-describe is false and review-modes is empty. ' +
          'Set auto-describe to true and/or provide at least one review-modes value.',
      );
      return;
    }

    async function runPass(
      label: 'describe' | 'review',
      prompt: string,
      rawTools: ReturnType<typeof createBugbitTools>,
      saveLog: boolean,
      claudeOptions: { systemPromptAppend?: string; skills?: string[] } = {},
    ): Promise<{ runId: string; streamLogPath?: string }> {
      // Models sometimes end their turn early (e.g. after printing a skill's report); resume them
      // until the pass has posted, and fail loudly rather than go green with nothing on the PR.
      const required =
        label === 'describe'
          ? requireToolCall(rawTools, ['update_pr_description'], DESCRIBE_NUDGE)
          : requireToolCall(rawTools, ['post_review', 'post_inline_comment'], REVIEW_NUDGE);
      const { tools, completion } = required;
      if (claudeAuth) {
        core.info(`Starting Claude agent (model: ${model || 'default'}, pass: ${label})`);
        const result = await runClaudeAgent(claudeAuth, prompt, cwd, tools, {
          model,
          saveStreamLog: saveLog,
          completion,
          ...claudeOptions,
        });
        core.info(`${label} pass completed: session ${result.runId}`);
        return result;
      }
      core.info(`Starting Cursor agent (model: ${model}, pass: ${label})`);
      const result = await runAgent(apiKey, model, prompt, cwd, tools, {
        saveStreamLog: saveLog,
        completion,
      });
      core.info(`${label} pass completed: run ${result.runId}`);
      return result;
    }

    async function uploadStreamLog(
      streamLogPath: string | undefined,
      runId: string | undefined,
      failOnError: boolean,
    ): Promise<void> {
      if (!saveStreamLog || !streamLogPath || !runId) {
        return;
      }
      try {
        const artifactName = streamLogArtifactName({
          agentRunId: runId,
          githubRunId: process.env.GITHUB_RUN_ID,
        });
        core.info(`Uploading stream log artifact "${artifactName}" from ${streamLogPath}…`);
        const uploadResponse = await withActionsRuntime(() =>
          uploadStreamLogArtifact(artifactName, streamLogPath),
        );
        core.info(
          `Uploaded stream log artifact "${artifactName}" (id: ${uploadResponse.id ?? 'unknown'})`,
        );
      } catch (error) {
        const message = artifactUploadErrorMessage(error);
        if (failOnError) {
          core.setFailed(message);
          throw error;
        }
        core.warning(`Stream log upload failed; continuing remaining passes: ${message}`);
      }
    }

    if (runDescribe) {
      const { prompt: describePrompt } = buildDescribePrompt(
        promptsDir,
        actionPath,
        prefetched,
        describeLabels,
      );
      const describeRun = await runPass(
        'describe',
        describePrompt,
        createBugbitTools(toolDeps, 'describe'),
        saveStreamLog,
        { skills: [] },
      );
      await uploadStreamLog(describeRun.streamLogPath, describeRun.runId, !runReview);
    }

    if (runReview) {
      const reviewTools = createBugbitTools(toolDeps, 'review');
      let reviewRun: { runId: string; streamLogPath?: string };
      if (provider === 'claude') {
        const refs = readPullRequestRefs(eventPath);
        if (refs) {
          prepareBaseRef(cwd, refs);
        }
        const { prompt, systemPromptAppend } = buildClaudeSkillPrompt(
          reviewModes.join(','),
          promptsDir,
          actionPath,
          prefetched,
          reviewLevel,
        );
        reviewRun = await runPass('review', prompt, reviewTools, saveStreamLog, {
          systemPromptAppend,
        });
      } else {
        const { prompt } = buildSkillPrompt(reviewModes.join(','), promptsDir, actionPath, prefetched);
        reviewRun = await runPass('review', prompt, reviewTools, saveStreamLog);
      }
      await uploadStreamLog(reviewRun.streamLogPath, reviewRun.runId, true);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
