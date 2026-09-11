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
const core = __importStar(require("@actions/core"));
const path = __importStar(require("path"));
const cursorAgent_1 = require("./agent/cursorAgent");
const artifactUpload_1 = require("./runtime/artifactUpload");
const actionPath_1 = require("./runtime/actionPath");
const checkCheckout_1 = require("./runtime/checkCheckout");
const reviewModes_1 = require("./prompts/reviewModes");
const tools_1 = require("./github/tools");
const resolveEvent_1 = require("./runtime/resolveEvent");
const sdkBootstrap_1 = require("./runtime/sdkBootstrap");
async function run() {
    try {
        (0, sdkBootstrap_1.bootstrapRipgrep)();
        const cwd = process.cwd();
        (0, checkCheckout_1.assertRepoCheckedOut)(cwd);
        const apiKey = core.getInput('cursor-api-key', { required: true });
        const githubToken = core.getInput('github-token', { required: true });
        core.setSecret(githubToken);
        const model = core.getInput('model') || 'composer-2.5';
        const modesInput = core.getInput('review-modes') || 'code-review';
        const saveStreamLog = core.getBooleanInput('save-stream-log');
        const postCleanSummaryInput = core.getInput('post-clean-summary');
        const postCleanSummary = postCleanSummaryInput === '' ? true : core.getBooleanInput('post-clean-summary');
        const cleanSummaryBody = core.getInput('clean-summary-body') ||
            '## bugbit: LGTM — no findings\n\nNo issues reported on this diff.';
        const prNumber = core.getInput('pr-number');
        const rawEventPath = process.env.GITHUB_EVENT_PATH ?? '';
        const repository = process.env.GITHUB_REPOSITORY ?? '';
        const eventPath = await (0, resolveEvent_1.resolveEvent)({
            token: githubToken,
            repository,
            eventPath: rawEventPath,
            prNumber: prNumber || undefined,
        });
        if ((0, tools_1.isForkPullRequest)(eventPath)) {
            core.setFailed('bugbit cannot post review comments on pull requests from forks: ' +
                'GITHUB_TOKEN is read-only for fork PRs. ' +
                'See bugbit documentation (DOCS-04) for workarounds.');
            return;
        }
        const actionPath = (0, actionPath_1.resolveActionPath)(cwd);
        const toolDeps = {
            githubToken,
            eventPath,
            repository,
            actionPath,
            postCleanSummary,
            cleanSummaryBody,
        };
        if (saveStreamLog) {
            core.info('save-stream-log enabled — consumer workflow must include actions: write');
        }
        try {
            await (0, tools_1.checkReviewPermissions)(toolDeps);
        }
        catch (error) {
            core.setFailed(error instanceof Error ? error.message : String(error));
            return;
        }
        // permissions.json is best-effort shell policy; custom tools are the trust boundary for PR ops.
        (0, tools_1.copyPermissionsToWorkspace)(actionPath, cwd);
        const promptsDir = path.join(actionPath, 'prompts');
        const prefetched = await (0, tools_1.prefetchPrData)(toolDeps);
        const { prompt, modes } = (0, reviewModes_1.buildSkillPrompt)(modesInput, promptsDir, actionPath, prefetched);
        const customTools = (0, tools_1.createBugbitTools)(toolDeps);
        core.info(`Starting Cursor agent (model: ${model}, modes: ${modes.join(', ')})`);
        const { runId, streamLogPath } = await (0, cursorAgent_1.runAgent)(apiKey, model, prompt, cwd, customTools, { saveStreamLog });
        if (saveStreamLog && streamLogPath) {
            try {
                const artifactName = (0, artifactUpload_1.streamLogArtifactName)({
                    agentRunId: runId,
                    githubRunId: process.env.GITHUB_RUN_ID,
                });
                core.info(`Uploading stream log artifact "${artifactName}" from ${streamLogPath}…`);
                const uploadResponse = await (0, artifactUpload_1.uploadStreamLogArtifact)(artifactName, streamLogPath);
                core.info(`Uploaded stream log artifact "${artifactName}" (id: ${uploadResponse.id ?? 'unknown'})`);
            }
            catch (error) {
                core.setFailed((0, artifactUpload_1.artifactUploadErrorMessage)(error));
                return;
            }
        }
    }
    catch (error) {
        core.setFailed(error instanceof Error ? error.message : String(error));
    }
}
run();
