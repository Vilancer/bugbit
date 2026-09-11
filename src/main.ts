import * as core from '@actions/core';
import * as path from 'path';
import { runAgent } from './agent/cursorAgent';
import {
  artifactUploadErrorMessage,
  streamLogArtifactName,
  uploadStreamLogArtifact,
} from './runtime/artifactUpload';
import { resolveActionPath } from './runtime/actionPath';
import { assertRepoCheckedOut } from './runtime/checkCheckout';
import { buildSkillPrompt } from './prompts/reviewModes';
import {
  checkReviewPermissions,
  copyPermissionsToWorkspace,
  createBugbitTools,
  isForkPullRequest,
  prefetchPrData,
} from './github/tools';
import { resolveEvent } from './runtime/resolveEvent';
import { bootstrapRipgrep } from './runtime/sdkBootstrap';

async function run(): Promise<void> {
  try {
    bootstrapRipgrep();

    const cwd = process.cwd();
    assertRepoCheckedOut(cwd);

    const apiKey = core.getInput('cursor-api-key', { required: true });
    const githubToken = core.getInput('github-token', { required: true });
    core.setSecret(githubToken);

    const model = core.getInput('model') || 'composer-2.5';
    const modesInput = core.getInput('review-modes') || 'code-review';
    const saveStreamLog = core.getBooleanInput('save-stream-log');
    const postCleanSummaryInput = core.getInput('post-clean-summary');
    const postCleanSummary =
      postCleanSummaryInput === '' ? true : core.getBooleanInput('post-clean-summary');
    const cleanSummaryBody =
      core.getInput('clean-summary-body') ||
      '## bugbit: LGTM — no findings\n\nNo issues reported on this diff.';

    const prNumber = core.getInput('pr-number');
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

    // permissions.json is best-effort shell policy; custom tools are the trust boundary for PR ops.
    copyPermissionsToWorkspace(actionPath, cwd);
    const promptsDir = path.join(actionPath, 'prompts');

    const prefetched = await prefetchPrData(toolDeps);
    const { prompt, modes } = buildSkillPrompt(modesInput, promptsDir, actionPath, prefetched);

    const customTools = createBugbitTools(toolDeps);

    core.info(`Starting Cursor agent (model: ${model}, modes: ${modes.join(', ')})`);
    const { runId, streamLogPath } = await runAgent(
      apiKey,
      model,
      prompt,
      cwd,
      customTools,
      { saveStreamLog },
    );

    if (saveStreamLog && streamLogPath) {
      try {
        const artifactName = streamLogArtifactName({
          agentRunId: runId,
          githubRunId: process.env.GITHUB_RUN_ID,
        });
        core.info(`Uploading stream log artifact "${artifactName}" from ${streamLogPath}…`);
        const uploadResponse = await uploadStreamLogArtifact(artifactName, streamLogPath);
        core.info(`Uploaded stream log artifact "${artifactName}" (id: ${uploadResponse.id ?? 'unknown'})`);
      } catch (error) {
        core.setFailed(artifactUploadErrorMessage(error));
        return;
      }
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
