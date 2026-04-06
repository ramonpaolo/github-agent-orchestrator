import { execSync, spawn } from 'child_process';
import { Issue } from '../github';
import path from 'path';
import fs from 'fs';

export interface OpenCodeResult {
  success: boolean;
  message: string;
  changedFiles: string[];
  error?: string;
}

export class OpenCodeClient {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Check if OpenCode is installed and configured
   */
  static isInstalled(): { installed: boolean; configured: boolean } {
    try {
      execSync('opencode --version', { stdio: 'pipe' });
      try {
        execSync('opencode auth list', { stdio: 'pipe' });
        return { installed: true, configured: true };
      } catch {
        return { installed: true, configured: false };
      }
    } catch {
      return { installed: false, configured: false };
    }
  }

  /**
   * Run OpenCode to implement an issue
   */
  async implementIssue(issue: Issue, additionalContext?: string): Promise<OpenCodeResult> {
    try {
      console.log(`🤖 Running OpenCode for issue #${issue.number}...`);

      // Generate semantic branch name based on issue
      const baseBranchName = this.generateBranchName(issue);
      const branchName = await this.ensureUniqueBranch(baseBranchName);
      
      console.log(`🌿 Using branch: ${branchName}`);

      // Build the prompt
      const prompt = this.buildPrompt(issue, branchName, additionalContext);
      const promptFile = path.join(this.workingDir, '.opencode-prompt.md');
      
      fs.writeFileSync(promptFile, prompt);
      
      // Run opencode
      const result = await this.runOpenCode(promptFile, branchName);
      
      // Clean up prompt file
      try {
        fs.unlinkSync(promptFile);
      } catch {}

      if (result.success) {
        // Detect changed files
        const changedFiles = this.detectChangedFiles();
        
        if (changedFiles.length > 0) {
          console.log(`✅ OpenCode made ${changedFiles.length} file change(s)`);
          changedFiles.forEach(f => console.log(`   - ${f}`));
        }
        
        return {
          success: true,
          message: `OpenCode completed on branch ${branchName}`,
          changedFiles,
        };
      }

      return {
        success: false,
        message: 'OpenCode failed',
        changedFiles: [],
        error: result.error,
      };
    } catch (error: any) {
      console.error('OpenCode error:', error.message);
      return {
        success: false,
        message: 'Failed to run OpenCode',
        changedFiles: [],
        error: error.message,
      };
    }
  }

  private generateBranchName(issue: Issue): string {
    // Clean the title for use as branch name
    const title = issue.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')     // Replace spaces with dashes
      .substring(0, 50);        // Limit length

    // Add prefix based on type
    let prefix = 'feat';
    const content = (issue.title + ' ' + issue.body).toLowerCase();
    
    if (content.includes('fix') || content.includes('bug') || content.includes('hotfix')) {
      prefix = 'fix';
    } else if (content.includes('docs') || content.includes('documentation')) {
      prefix = 'docs';
    } else if (content.includes('refactor') || content.includes('cleanup')) {
      prefix = 'refactor';
    } else if (content.includes('chore') || content.includes('maintenance')) {
      prefix = 'chore';
    }

    // Pattern: <prefix>/<issue-number>-ai-<title>
    return `${prefix}/${issue.number}-ai-${title}`;
  }

  private async ensureUniqueBranch(baseName: string): Promise<string> {
    // Check if branch exists locally or remotely
    let branchName = baseName;
    let counter = 1;

    while (true) {
      const existsLocal = this.branchExists(branchName, 'local');
      const existsRemote = this.branchExists(branchName, 'remote');

      if (!existsLocal && !existsRemote) {
        return branchName;
      }

      // Branch exists, try with suffix
      branchName = `${baseName}-${counter}`;
      counter++;

      // Safety limit
      if (counter > 100) {
        throw new Error('Could not find unique branch name');
      }
    }
  }

  private branchExists(branchName: string, type: 'local' | 'remote'): boolean {
    try {
      if (type === 'local') {
        const output = execSync('git branch --list', {
          cwd: this.workingDir,
          encoding: 'utf8',
        });
        return output.split('\n').some(b => b.trim().replace(/^\* /, '') === branchName);
      } else {
        const output = execSync(`git ls-remote --heads origin ${branchName}`, {
          cwd: this.workingDir,
          encoding: 'utf8',
        });
        return output.trim().length > 0;
      }
    } catch {
      return false;
    }
  }

  private async runOpenCode(promptFile: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // First, create and switch to the new branch
      try {
        // Make sure main is up to date
        execSync('git fetch origin main', { cwd: this.workingDir, stdio: 'pipe' });
        execSync('git checkout -B main origin/main', { cwd: this.workingDir, stdio: 'pipe' });
        execSync(`git checkout -B ${branchName}`, { cwd: this.workingDir, stdio: 'pipe' });
        console.log(`✅ Branch ${branchName} created`);
      } catch (error: any) {
        resolve({ success: false, error: `Failed to create branch: ${error.message}` });
        return;
      }

      // Run opencode with the prompt
      const proc = spawn('opencode', [
        'run',
        '--yes',
        `--project=${this.workingDir}`,
        `Read the task from ${promptFile} and implement it. Make all necessary code changes. Commit your changes with a descriptive commit message.`
      ], {
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stderr = '';

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        // Show some output
        if (text.includes('Thinking') || text.includes('Implementing')) {
          process.stdout.write('.');
        }
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || `OpenCode exited with code: ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'OpenCode timed out after 5 minutes' });
      }, 5 * 60 * 1000);
    });
  }

  private buildPrompt(issue: Issue, branchName: string, additionalContext?: string): string {
    return `# Task: ${issue.title}

## Issue #${issue.number}
**Author:** @${issue.author}
**Branch:** ${branchName}

## Description
${issue.body}

${additionalContext ? `## Additional Context\n${additionalContext}\n` : ''}

## Instructions
You are an AI coding assistant working on this issue. Follow these steps:

1. **Create a branch** called \`${branchName}\` (already created)
2. **Read and understand** the issue above
3. **Explore the codebase** to understand the project structure
4. **Implement the changes** to fulfill this task
5. **Write tests** if applicable
6. **Commit your changes** with a descriptive commit message

Important:
- Focus on actual CODE changes, not documentation
- Ensure the code compiles and works correctly
- Follow the project's coding conventions
- Do NOT create files in \`solutions/\` or \`.agent-\` directories

Please implement this feature/bug fix/refactor now.
`;
  }

  private detectChangedFiles(): string[] {
    try {
      const output = execSync('git status --porcelain', {
        cwd: this.workingDir,
        encoding: 'utf8',
      }).trim();
      
      if (!output) return [];

      return output
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.substring(3).trim())
        .filter(file => 
          !file.includes('.opencode-prompt.md') &&
          !file.startsWith('solutions/') &&
          !file.startsWith('.agent-')
        );
    } catch {
      return [];
    }
  }
}

/**
 * Run OpenCode to implement an issue
 */
export async function runOpenCodeForIssue(
  issue: Issue,
  workingDir: string,
  additionalContext?: string
): Promise<OpenCodeResult> {
  const opencode = new OpenCodeClient(workingDir);
  return await opencode.implementIssue(issue, additionalContext);
}
