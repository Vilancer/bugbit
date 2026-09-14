#!/usr/bin/env node
import { getDiff } from './lib/operations.mjs';
import { printJson, fail } from './lib/errors.mjs';

const deps = {
  token: process.env.GITHUB_TOKEN,
  eventPath: process.env.GITHUB_EVENT_PATH,
  repository: process.env.GITHUB_REPOSITORY,
};

try {
  printJson(await getDiff(deps));
} catch (e) {
  fail('GET_DIFF_ERROR', e.message);
}
