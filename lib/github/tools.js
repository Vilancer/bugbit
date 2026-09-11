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
exports.checkReviewPermissions = checkReviewPermissions;
exports.copyPermissionsToWorkspace = copyPermissionsToWorkspace;
exports.prefetchPrData = prefetchPrData;
exports.isForkPullRequest = isForkPullRequest;
exports.createBugbitTools = createBugbitTools;
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
const dynamicImport_1 = require("../runtime/dynamicImport");
const resolveActionModule_1 = require("../runtime/resolveActionModule");
const opsPromises = new Map();
const preflightPromises = new Map();
const eventPromises = new Map();
function loadOps(actionPath) {
    let promise = opsPromises.get(actionPath);
    if (!promise) {
        promise = (0, dynamicImport_1.dynamicImport)((0, resolveActionModule_1.resolveActionModuleUrl)(actionPath, 'operations'));
        opsPromises.set(actionPath, promise);
    }
    return promise;
}
function loadPreflight(actionPath) {
    let promise = preflightPromises.get(actionPath);
    if (!promise) {
        promise = (0, dynamicImport_1.dynamicImport)((0, resolveActionModule_1.resolveActionModuleUrl)(actionPath, 'preflight'));
        preflightPromises.set(actionPath, promise);
    }
    return promise;
}
function loadEventModule(actionPath) {
    let promise = eventPromises.get(actionPath);
    if (!promise) {
        const eventUrl = (0, url_1.pathToFileURL)(path.join(actionPath, 'scripts', 'lib', 'event.mjs')).href;
        promise = (0, dynamicImport_1.dynamicImport)(eventUrl);
        eventPromises.set(actionPath, promise);
    }
    return promise;
}
async function assertPullRequestContext(deps) {
    const { assertPullRequestContext: assertContext } = await loadEventModule(deps.actionPath);
    assertContext(deps.eventPath);
}
function toOpsDeps(deps) {
    return {
        token: deps.githubToken,
        eventPath: deps.eventPath,
        repository: deps.repository,
        postCleanSummary: deps.postCleanSummary,
        cleanSummaryBody: deps.cleanSummaryBody,
    };
}
async function checkReviewPermissions(deps) {
    try {
        await assertPullRequestContext(deps);
    }
    catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
    const { assertReviewPermissions, formatPermissionErrorMessage } = await loadPreflight(deps.actionPath);
    core.info('Checking GitHub token permissions for PR review…');
    try {
        await assertReviewPermissions(toOpsDeps(deps));
    }
    catch (error) {
        throw new Error(formatPermissionErrorMessage(error));
    }
    core.info('GitHub token permissions OK');
}
function copyPermissionsToWorkspace(actionPath, cwd) {
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
async function prefetchPrData(deps) {
    const ops = await loadOps(deps.actionPath);
    const toolDeps = toOpsDeps(deps);
    core.info('Prefetching PR context and diff…');
    const context = await ops.getPrContext(toolDeps);
    const diff = await ops.getDiff(toolDeps);
    const typedDiff = diff;
    const fileCount = Array.isArray(typedDiff.files) ? typedDiff.files.length : 0;
    const diffMode = typeof typedDiff.diffMode === 'string' ? typedDiff.diffMode : 'full';
    core.info(`Prefetched diff: ${fileCount} changed file(s) (diffMode=${diffMode})`);
    return { context, diff };
}
function isForkPullRequest(eventPath) {
    if (!eventPath)
        return false;
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const pr = event.pull_request;
    if (!pr)
        return false;
    return pr.head?.repo?.full_name !== pr.base?.repo?.full_name;
}
function createBugbitTools(deps) {
    const toolDeps = toOpsDeps(deps);
    return {
        get_pr_context: {
            description: 'Returns PR number, title, body, head/base branch names, and commit SHAs for the current pull_request event.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            execute: async () => {
                core.info('[bugbit] get_pr_context called');
                const ops = await loadOps(deps.actionPath);
                return (await ops.getPrContext(toolDeps));
            },
        },
        get_diff: {
            description: 'Returns changed files for the current PR with diffMode (full | hunk_ranges | paths_only). Prefer prefetched data; use when missing.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            execute: async () => {
                core.info('[bugbit] get_diff called');
                const ops = await loadOps(deps.actionPath);
                return (await ops.getDiff(toolDeps));
            },
        },
        post_review: {
            description: 'Posts multiple inline comments as one PR review; prefer this over repeated post_inline_comment calls. Pass an empty findings array when there are no issues (may post an LGTM summary when configured).',
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
                const findings = args.findings;
                core.info(`[bugbit] post_review called with ${findings.length} finding(s)`);
                const ops = await loadOps(deps.actionPath);
                const result = (await ops.postReview(toolDeps, findings));
                core.info('[bugbit] post_review completed');
                return result;
            },
        },
        post_inline_comment: {
            description: 'Posts a single inline comment on a specific file and line in the PR diff.',
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
                    path: args.path,
                    line: args.line,
                    body: args.body,
                });
                return result;
            },
        },
    };
}
