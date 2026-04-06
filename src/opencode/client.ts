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
      // Check if opencode command exists
      execSync('opencode --version', { stdio: 'pipe' });
      
      // Check if providers are configured
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
      // Build the prompt file
      const prompt = this.buildPrompt(issue, additionalContext);
      const promptFile = path.join(this.workingDir, '.opencode-prompt.md');
      
      fs.writeFileSync(promptFile, prompt);
      
      console.log(`🤖 Running OpenCode for issue #${issue.number}...`);
      
      // Run opencode with the prompt
      // OpenCode will read the project, understand the codebase, and make changes
      const result = await this.runOpenCodeInteractive(promptFile);
      
      // Clean up prompt file
      try {
        fs.unlinkSync(promptFile);
      } catch {}
      
      // Detect changed files
      const changedFiles = this.detectChangedFiles();
      
      if (changedFiles.length > 0) {
        console.log(`✅ OpenCode made ${changedFiles.length} file change(s)`);
        changedFiles.forEach(f => console.log(`   - ${f}`));
      }
      
      return {
        success: result.success,
        message: result.message,
        changedFiles,
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

  private async runOpenCodeInteractive(promptFile: string): Promise<{ success: boolean; message: string; error?: string }> {
    return new Promise((resolve) => {
      // Run opencode with automatic mode
      // The --yes flag makes it apply changes automatically
      const proc = spawn('opencode', [
        'run',
        '--yes',
        `--project=${this.workingDir}`,
        `Read the task from ${promptFile} and implement it. Make all necessary code changes.`
      ], {
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Show progress
        if (text.includes('Thinking') || text.includes('Applying')) {
          process.stdout.write('.');
        }
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, message: 'OpenCode completed successfully' });
        } else {
          resolve({
            success: false,
            message: 'OpenCode exited with error',
            error: stderr || `Exit code: ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          message: 'Failed to start OpenCode',
          error: err.message,
        });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          message: 'OpenCode timed out',
          error: 'Timeout after 5 minutes',
        });
      }, 5 * 60 * 1000);
    });
  }

  private buildPrompt(issue: Issue, additionalContext?: string): string {
    return `# Task: ${issue.title}

## Issue #${issue.number}
**Author:** @${issue.author}

## Description
${issue.body}

${additionalContext ? `## Additional Context\n${additionalContext}\n` : ''}

## Instructions
You are an AI coding assistant. Your task is to:

1. Read and understand the issue above
2. Explore the codebase to understand the project structure
3. Implement the necessary changes to fulfill this task
4. Make sure all changes are complete and functional
5. Do NOT create documentation files - focus on actual code changes
6. Ensure the code compiles/runs correctly
7. Follow the project's coding conventions and style

Please implement this feature/bug fix/refactor and make the necessary file changes.
`;
  }

  private detectChangedFiles(): string[] {
    try {
      // Use git to detect changed files
      const output = execSync('git status --porcelain', {
        cwd: this.workingDir,
        encoding: 'utf8',
      }).trim();
      
      if (!output) return [];

      return output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const status = line.substring(0, 2);
          const file = line.substring(3).trim();
          return file;
        })
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
