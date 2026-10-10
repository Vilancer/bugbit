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
exports.CLAUDE_AGENT_SDK_VERSION = void 0;
exports.claudeSdkInstallDir = claudeSdkInstallDir;
exports.installClaudeAgentSdk = installClaudeAgentSdk;
exports.loadClaudeAgentSdk = loadClaudeAgentSdk;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const core = __importStar(require("@actions/core"));
const dynamicImport_1 = require("./dynamicImport");
/**
 * Pinned Claude Agent SDK. It is installed on the runner at run time instead of
 * bundled: the package is ESM-only and ships a ~250MB native Claude Code binary
 * per platform, which ncc cannot (and should not) inline into dist/index.js.
 */
exports.CLAUDE_AGENT_SDK_VERSION = '0.3.296';
const PEER_PACKAGES = ['zod@4.6.5', '@modelcontextprotocol/sdk@1.32.1', '@anthropic-ai/sdk@0.133.0'];
/** Re-exports the SDK and zod from one ESM graph so tool schemas share the SDK's zod instance. */
const ENTRY_SOURCE = [
    "export { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';",
    "export { z } from 'zod';",
    '',
].join('\n');
function claudeSdkInstallDir() {
    return path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `bugbit-claude-agent-sdk-${exports.CLAUDE_AGENT_SDK_VERSION}`);
}
function installClaudeAgentSdk(installDir = claudeSdkInstallDir()) {
    const entryPath = path.join(installDir, 'bugbit-entry.mjs');
    const sdkPackageJson = path.join(installDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
    if (!fs.existsSync(sdkPackageJson)) {
        core.info(`Installing @anthropic-ai/claude-agent-sdk@${exports.CLAUDE_AGENT_SDK_VERSION} into ${installDir}…`);
        fs.mkdirSync(installDir, { recursive: true });
        fs.writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({ name: 'bugbit-claude-runtime', private: true, type: 'module' }));
        (0, node_child_process_1.execFileSync)('npm', [
            'install',
            '--no-audit',
            '--no-fund',
            '--no-package-lock',
            '--loglevel=error',
            `@anthropic-ai/claude-agent-sdk@${exports.CLAUDE_AGENT_SDK_VERSION}`,
            ...PEER_PACKAGES,
        ], { cwd: installDir, stdio: 'inherit' });
    }
    fs.writeFileSync(entryPath, ENTRY_SOURCE);
    return entryPath;
}
let sdkPromise;
async function importClaudeAgentSdk() {
    try {
        return await (0, dynamicImport_1.dynamicImport)((0, node_url_1.pathToFileURL)(installClaudeAgentSdk()).href);
    }
    catch (error) {
        sdkPromise = undefined; // let a later call retry the install
        throw error;
    }
}
function loadClaudeAgentSdk() {
    sdkPromise ??= importClaudeAgentSdk();
    return sdkPromise;
}
