import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

export const config = {
  github: {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',
    repoPath: process.env.GITHUB_REPO_PATH || '',
  },
  polling: {
    interval: parseInt(process.env.POLLING_INTERVAL || '60', 10),
    enabled: process.env.POLLING_ENABLED !== 'false',
  },
  agent: {
    maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || '4096', 10),
    model: process.env.AGENT_MODEL || 'gpt-4',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
  labels: {
    ready: 'agent:ready',
    implementing: 'agent:implementing',
    done: 'agent:done',
    failed: 'agent:failed',
    blocked: 'agent:blocked',
  },
};

export function validateConfig(): boolean {
  const errors: string[] = [];

  if (!config.github.token) {
    errors.push('GITHUB_TOKEN is required');
  }
  if (!config.github.repo) {
    errors.push('GITHUB_REPO is required (format: owner/repo)');
  }
  if (!config.github.repoPath) {
    errors.push('GITHUB_REPO_PATH is required');
  } else if (!fs.existsSync(config.github.repoPath)) {
    errors.push(`Repository path does not exist: ${config.github.repoPath}`);
  }

  if (errors.length > 0) {
    console.error('❌ Configuration validation failed:');
    errors.forEach((e) => console.error(`   - ${e}`));
    return false;
  }

  return true;
}
