import { execSync, spawn } from 'child_process';
import { Issue } from '../github';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

const SDK = require(path.join(__dirname, '..', '..', 'node_modules', '@opencode-ai', 'sdk', 'dist', 'index.js'));

const logEmitter = new EventEmitter();

export function getLogEmitter(): EventEmitter {
  return logEmitter;
}

function emitLog(line: string): void {
  logEmitter.emit('log', line);
}

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

  async implementIssue(issue: Issue, additionalContext?: string): Promise<OpenCodeResult> {
    try {
      console.log(`🤖 Running OpenCode for issue #${issue.number}...`);

      const baseBranchName = this.generateBranchName(issue);
      const branchName = await this.ensureUniqueBranch(baseBranchName);

      console.log(`🌿 Using branch: ${branchName}`);

      const prompt = this.buildPrompt(issue, branchName, additionalContext);
      const promptFile = path.join(this.workingDir, '.opencode-prompt.md');

      fs.writeFileSync(promptFile, prompt);

      const result = await this.runOpenCodeWithSDK(prompt, branchName);

      try {
        fs.unlinkSync(promptFile);
      } catch {}

      if (result.success) {
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
    const title = issue.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    let prefix = 'feat';
    const content = (issue.title + ' ' + issue.body).toLowerCase();

    if (content.includes('fix') || content.includes('bug')) prefix = 'fix';
    else if (content.includes('docs')) prefix = 'docs';
    else if (content.includes('refactor')) prefix = 'refactor';
    else if (content.includes('chore')) prefix = 'chore';

    return `${prefix}/${issue.number}-ai-${title}`;
  }

  private async ensureUniqueBranch(baseName: string): Promise<string> {
    let branchName = baseName;
    let counter = 1;

    while (true) {
      const existsLocal = this.branchExists(branchName, 'local');
      const existsRemote = this.branchExists(branchName, 'remote');

      if (!existsLocal && !existsRemote) {
        return branchName;
      }

      branchName = `${baseName}-${counter}`;
      counter++;

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

  private async runOpenCodeWithSDK(prompt: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    return new Promise(async (resolve) => {
      execSync('git fetch origin main', { cwd: this.workingDir, stdio: 'pipe' });
      try {
        execSync('git stash', { cwd: this.workingDir, stdio: 'pipe' });
      } catch {
        // No changes to stash, that's ok
      }
      execSync('git checkout -B main origin/main', { cwd: this.workingDir, stdio: 'pipe' });
      execSync(`git checkout -B ${branchName}`, { cwd: this.workingDir, stdio: 'pipe' });
      emitLog(`✅ Branch ${branchName} created`);

      emitLog('🚀 Starting OpenCode SDK...');

      try {
        const createOpencode = SDK.createOpencode;
        const result = await createOpencode({
          port: 4096,
          hostname: '127.0.0.1',
        });

        const client = result.client;
        emitLog(`✅ OpenCode SDK connected at ${result.server.url}`);

        const promptWithInstructions = `${prompt}

## Instructions
You are an AI coding assistant. Follow these steps:
1. Read and understand the task above
2. Explore the codebase to understand the project structure
3. Implement the changes to fulfill this task
4. Write tests if applicable
5. Commit your changes with a descriptive commit message

Important:
- Focus on actual CODE changes
- Ensure the code compiles and works correctly
- Follow the project's coding conventions

Please implement this feature/bug fix/refactor now.

When you complete the implementation, use the bash tool to run: git add -A && git commit -m "feat: implement issue ${branchName}"`;

        emitLog('🤖 Sending task to OpenCode...');

        let completed = false;
        let success = false;
        let errorMsg: string | undefined;

        try {
          const session = await client.session.create({});
          const sessionId = session.data?.id;
          emitLog(`📡 Session created: ${sessionId}`);

          const events = await client.event.subscribe({ path: { id: sessionId } });

          (async () => {
            try {
              for await (const event of events.stream) {
                if (completed) break;
                const props = event.properties || {};
                const sessionId = props.sessionID;
                
                if (event.type === 'server.connected') {
                  emitLog('📡 Connected to OpenCode');
                } else if (event.type === 'session.status') {
                  const status = props.status?.type;
                  if (status === 'busy') {
                    emitLog('🔄 Working...');
                  } else if (status === 'idle') {
                    emitLog('✅ Session idle');
                  }
                } else if (event.type === 'session.idle') {
                  completed = true;
                  success = true;
                  emitLog('✅ OpenCode completed!');
                } else if (event.type === 'message.part.delta') {
                  const part = props.part || {};
                  if (part.type === 'text' && props.delta) {
                    emitLog(`💬 ${props.delta.substring(0, 200)}`);
                  } else if (part.type === 'reasoning' && props.delta) {
                    emitLog(`🤔 ${props.delta.substring(0, 100)}...`);
                  }
                } else if (event.type === 'message.part.updated') {
                  const part = props.part || {};
                  if (part.type === 'tool_use') {
                    const status = part.state?.status;
                    const toolName = part.tool;
                    if (status === 'running') {
                      emitLog(`⚙️ [${toolName}] Running...`);
                    } else if (status === 'completed') {
                      emitLog(`✅ [${toolName}] Done`);
                    } else if (status === 'error') {
                      emitLog(`❌ [${toolName}] Error: ${part.state?.error || 'Unknown'}`);
                    }
                  } else if (part.type === 'text' && part.text) {
                    emitLog(`💬 ${part.text.substring(0, 200)}`);
                  } else if (part.type === 'reasoning' && part.text) {
                    emitLog(`🤔 ${part.text.substring(0, 100)}...`);
                  }
                } else if (event.type === 'session.diff') {
                  const diff = props.diff || [];
                  if (diff.length > 0) {
                    emitLog(`📝 ${diff.length} file(s) changed`);
                  }
                }
              }
            } catch (e) {
              if (!completed) {
                errorMsg = e instanceof Error ? e.message : 'Unknown error';
                emitLog(`❌ Stream error: ${errorMsg}`);
              }
            }
          })();

          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: 'text', text: promptWithInstructions }]
            }
          });

          const timeout = setTimeout(() => {
            if (!completed) {
              completed = true;
              success = false;
              errorMsg = 'Timeout';
              emitLog('❌ OpenCode timed out after 15 minutes');
              result.server.close();
            }
          }, 15 * 60 * 1000);

          const checkCompletion = setInterval(() => {
            if (completed) {
              clearInterval(checkCompletion);
              clearTimeout(timeout);
              try {
                result.server.close();
              } catch {}
              resolve({ success, error: errorMsg });
            }
          }, 1000);

        } catch (error: any) {
          emitLog(`❌ OpenCode error: ${error.message}`);
          errorMsg = error.message;
          try {
            result.server.close();
          } catch {}
          resolve({ success: false, error: errorMsg });
        }

      } catch (error: any) {
        emitLog(`❌ Failed to start OpenCode SDK: ${error.message}`);
        resolve({ success: false, error: error.message });
      }
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

export async function runOpenCodeForIssue(
  issue: Issue,
  workingDir: string,
  additionalContext?: string
): Promise<OpenCodeResult> {
  const opencode = new OpenCodeClient(workingDir);
  return await opencode.implementIssue(issue, additionalContext);
}
