import chalk from 'chalk';
import { execSync } from 'child_process';

export interface PrerequisitesResult {
  ok: boolean;
  errors: string[];
}

export function checkPrerequisites(): PrerequisitesResult {
  const errors: string[] = [];

  // Check GitHub token
  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    // Try to get from gh CLI
    try {
      execSync('gh auth token', { stdio: 'pipe' });
    } catch {
      errors.push('❌ GITHUB_TOKEN not configured');
      errors.push('   Set GITHUB_TOKEN environment variable or run: gh auth login');
    }
  }

  // Check OpenCode installation
  try {
    execSync('opencode --version', { stdio: 'pipe' });
  } catch {
    errors.push('❌ OpenCode not installed');
    errors.push('   Install from: https://opencode.ai');
    errors.push('   Or run: curl -L https://opencode.ai/install.sh | sh');
  }

  // Check OpenCode providers
  if (errors.length === 0) {
    try {
      const output = execSync('opencode models list 2>/dev/null || echo "no-config"', { encoding: 'utf8' });
      if (output.includes('no-config') || output.includes('No providers')) {
        errors.push('❌ OpenCode has no API providers configured');
        errors.push('   Run: opencode auth login');
        errors.push('   Then configure your API key (Anthropic, OpenAI, etc.)');
      }
    } catch {
      // Ignore - OpenCode might not have models list command
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function printPrerequisitesCheck(): void {
  console.log(chalk.cyan.bold('\n🔍 Checking prerequisites...\n'));

  const result = checkPrerequisites();

  if (result.ok) {
    console.log(chalk.green('✅ All prerequisites met!'));
  } else {
    console.log(chalk.red('❌ Prerequisites check failed:\n'));
    result.errors.forEach(err => console.log(chalk.red(err)));
    console.log('');
  }
}
