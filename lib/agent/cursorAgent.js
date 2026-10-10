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
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_TIMEOUT_MS = void 0;
exports.runAgent = runAgent;
const sdk_1 = require("@cursor/sdk");
const core = __importStar(require("@actions/core"));
const runWait_1 = require("./runWait");
const streamLog_1 = require("./streamLog");
var runWait_2 = require("./runWait");
Object.defineProperty(exports, "AGENT_TIMEOUT_MS", { enumerable: true, get: function () { return runWait_2.AGENT_TIMEOUT_MS; } });
async function runAgent(apiKey, model, prompt, cwd, customTools, options = {}) {
    core.setSecret(apiKey);
    const deadlineMs = Date.now() + runWait_1.AGENT_TIMEOUT_MS;
    let logger;
    let activeRun;
    try {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            (0, runWait_1.assertWithinDeadline)(deadlineMs);
            // permissions.json copied to cwd/.cursor/ is best-effort for Shell exploration; PR ops use customTools.
            const agent = __addDisposableResource(env_1, await sdk_1.Agent.create({
                apiKey,
                model: { id: model },
                local: {
                    cwd,
                    customTools,
                    autoReview: false,
                    // Never load rules, MCP servers or settings from the PR head checkout. (No sandboxOptions:
                    // the Cursor SDK refuses to start with it on GitHub-hosted runners.)
                    settingSources: [],
                },
            }), true);
            const firstRun = await agent.send(prompt);
            core.info(`Started run ${firstRun.id} (agent ${agent.agentId})`);
            const streamLogPath = options.saveStreamLog ? (0, streamLog_1.streamLogPathFor)(firstRun.id) : undefined;
            logger = new streamLog_1.StreamLogger({
                saveStreamLog: options.saveStreamLog,
                streamLogPath,
            });
            const completion = options.completion;
            let run = firstRun;
            for (let nudges = 0;; nudges++) {
                activeRun = run;
                for await (const event of run.stream()) {
                    (0, runWait_1.assertWithinDeadline)(deadlineMs);
                    logger.handleEvent(event);
                }
                const result = await (0, runWait_1.waitForRunWithHeartbeat)(run, (0, runWait_1.remainingMs)(deadlineMs));
                if (result.status === 'error') {
                    throw new Error(`Agent run failed: ${result.id}`);
                }
                if (result.status === 'cancelled') {
                    throw new Error(`Agent run cancelled: ${result.id}`);
                }
                core.info(`Run completed with status=${result.status}`);
                if (!completion || completion.done())
                    break;
                if (nudges >= (completion.maxNudges ?? 2)) {
                    throw new Error(`Cursor agent finished without ${completion.missing} after ${nudges} follow-up(s)`);
                }
                core.warning(`Cursor agent stopped without ${completion.missing}; asking it to finish (${nudges + 1})`);
                // A follow-up on the same agent keeps its conversation and findings so far.
                run = await agent.send(completion.nudge);
            }
            await logger.close();
            return {
                runId: firstRun.id,
                streamLogPath,
            };
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            const result_1 = __disposeResources(env_1);
            if (result_1)
                await result_1;
        }
    }
    catch (error) {
        await activeRun?.cancel?.().catch(() => { });
        await logger?.close().catch(() => { });
        if (error instanceof sdk_1.CursorAgentError) {
            throw new Error(`Agent startup failed: ${error.message} (retryable=${error.isRetryable})`);
        }
        throw error;
    }
}
