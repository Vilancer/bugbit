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
exports.readPullRequestRefs = readPullRequestRefs;
exports.prepareBaseRef = prepareBaseRef;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const core = __importStar(require("@actions/core"));
const DEEPEN_STEP = 50;
const MAX_DEEPEN_ROUNDS = 10;
function git(cwd, args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function succeeds(cwd, args) {
    try {
        git(cwd, args);
        return true;
    }
    catch {
        return false;
    }
}
function readPullRequestRefs(eventPath) {
    try {
        const pr = JSON.parse(fs.readFileSync(eventPath, 'utf8')).pull_request;
        const baseRef = pr?.base?.ref;
        const headSha = pr?.head?.sha;
        return typeof baseRef === 'string' && typeof headSha === 'string' ? { baseRef, headSha } : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Makes `origin/HEAD` point at the PR base branch with a reachable merge base, so Claude Code
 * skills that diff against it (`/security-review` runs `git diff origin/HEAD...`) work on the
 * default shallow `actions/checkout`. Best effort: failures only degrade those skills.
 */
function prepareBaseRef(cwd, refs) {
    const remoteRef = `refs/remotes/origin/${refs.baseRef}`;
    try {
        // On a shallow checkout fetch the base shallow too, or it pulls the base branch's full history.
        const shallow = git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true';
        git(cwd, [
            'fetch',
            '--no-tags',
            '--quiet',
            ...(shallow ? [`--depth=${DEEPEN_STEP}`] : []),
            'origin',
            `+refs/heads/${refs.baseRef}:${remoteRef}`,
        ]);
        git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', remoteRef]);
        for (let round = 0; !succeeds(cwd, ['merge-base', 'HEAD', remoteRef]); round++) {
            if (round >= MAX_DEEPEN_ROUNDS || !shallow) {
                core.warning(`No merge base between HEAD and origin/${refs.baseRef}; skills that diff against origin/HEAD may fail. ` +
                    'Use actions/checkout with fetch-depth: 0 to avoid this.');
                return false;
            }
            git(cwd, [
                'fetch',
                '--no-tags',
                '--quiet',
                `--deepen=${DEEPEN_STEP}`,
                'origin',
                refs.headSha,
                `+refs/heads/${refs.baseRef}:${remoteRef}`,
            ]);
        }
        core.info(`origin/HEAD → origin/${refs.baseRef} (merge base reachable)`);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        core.warning(`Could not fetch origin/${refs.baseRef} for Claude skills: ${message}`);
        return false;
    }
}
