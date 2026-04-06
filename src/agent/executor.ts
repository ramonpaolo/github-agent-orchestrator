import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Issue, FileChange } from '../github';
import { GitHubClient } from '../github/client';
import { runOpenCodeForIssue, OpenCodeResult } from '../opencode';
import { config } from '../config';

export enum ExecutionStatus {
  CAN_EXECUTE = 'can_execute',
  NEEDS_CLARIFICATION = 'needs_clarification',
  EXECUTED = 'executed',
}

export interface ExecutionResult {
  status: ExecutionStatus;
  changes: FileChange[];
  branchName?: string;
  error?: string;
  opencodeResult?: OpenCodeResult;
  questions?: string[];
  reason?: string;
}

export class TaskExecutor {
  private client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  async execute(issue: Issue, dryRun: boolean = false): Promise<ExecutionResult> {
    console.log(`🔧 Analyzing issue #${issue.number}...`);

    const analysis = this.analyzeIssue(issue);
    console.log(`📋 Task type: ${analysis.taskType}`);
    console.log(`🤖 Sending to OpenCode...`);

    // Use OpenCode to implement the task
    const workingDir = this.client.getRepoPath();
    const result = await runOpenCodeForIssue(issue, workingDir);

    if (result.success) {
      console.log(`✅ OpenCode completed successfully`);
      console.log(`📁 Changed files: ${result.changedFiles.length}`);
      result.changedFiles.forEach(f => console.log(`   - ${f}`));

      // Get current branch name
      const branchName = this.getCurrentBranch(workingDir);
      console.log(`🌿 Current branch: ${branchName}`);

      // Return the changed files and branch name
      return {
        status: ExecutionStatus.EXECUTED,
        changes: result.changedFiles.map(file => ({
          path: file,
          content: '',
          operation: 'modify' as const,
        })),
        branchName,
      };
    } else {
      console.log(`❌ OpenCode failed: ${result.error}`);
      return {
        status: ExecutionStatus.CAN_EXECUTE,
        changes: [],
        error: result.error,
      };
    }
  }

  private getCurrentBranch(workingDir: string): string | undefined {
    try {
      const output = execSync('git branch --show-current', {
        cwd: workingDir,
        encoding: 'utf8',
      }).trim();
      return output || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a blocked issue has received new responses from the user.
   * Returns the user's response content if they answered, or null otherwise.
   */
  async checkForUserResponse(issueNumber: number): Promise<string | null> {
    const comments = await this.client.getComments(issueNumber);
    
    if (comments.length === 0) return null;

    // Find our last clarification comment
    const ourComments = comments.filter(c => c.body.includes('🤖 **Agent Clarification Needed**'));
    
    if (ourComments.length === 0) {
      // We never asked for clarification, maybe other bot did?
      // Check if issue was recently updated
      const updatedAt = await this.client.getIssueUpdatedAt(issueNumber);
      if (updatedAt) {
        const updated = new Date(updatedAt);
        const now = new Date();
        const hoursSinceUpdate = (now.getTime() - updated.getTime()) / (1000 * 60 * 60);
        return hoursSinceUpdate < 24 ? '' : null; // Return empty string for recent updates
      }
      return null;
    }

    // Get the most recent comment from us
    const ourLastComment = ourComments[ourComments.length - 1];
    const ourCommentTime = new Date(ourLastComment.createdAt).getTime();

    // Check if there's a newer comment from someone else (not a bot)
    const newerComments = comments.filter(c => {
      const commentTime = new Date(c.createdAt).getTime();
      const isNewer = commentTime > ourCommentTime;
      const isNotOurs = c.user !== 'github-actions[bot]' && !c.user.includes('bot');
      return isNewer && isNotOurs;
    });

    if (newerComments.length > 0) {
      console.log(`✅ User responded! Found ${newerComments.length} new comment(s)`);
      // Return all user responses combined
      return newerComments.map(c => c.body).join('\n\n---\n\n');
    }

    return null;
  }

  /**
   * Get issue with full context including user comments.
   * This combines the original issue body with relevant user responses.
   */
  async getIssueWithContext(issueNumber: number): Promise<Issue | null> {
    const issue = await this.client.getIssue(issueNumber);
    if (!issue) return null;

    const comments = await this.client.getComments(issueNumber);
    const ourComments = comments.filter(c => c.body.includes('🤖 **Agent Clarification Needed**'));
    
    if (ourComments.length === 0) {
      return issue; // No clarification was asked, return as is
    }

    // Find our last clarification comment
    const ourLastComment = ourComments[ourComments.length - 1];
    const ourCommentTime = new Date(ourLastComment.createdAt).getTime();

    // Get user responses after our clarification
    const userResponses = comments.filter(c => {
      const commentTime = new Date(c.createdAt).getTime();
      const isNewer = commentTime > ourCommentTime;
      const isNotOurs = c.user !== 'github-actions[bot]' && !c.user.includes('bot');
      return isNewer && isNotOurs;
    });

    if (userResponses.length > 0) {
      // Append user responses to the issue body
      const contextAppendix = userResponses
        .map(c => `\n\n## Additional Context from @${c.user}:\n\n${c.body}`)
        .join('');
      
      return {
        ...issue,
        body: issue.body + contextAppendix
      };
    }

    return issue;
  }

  private analyzeIssue(issue: Issue): {
    taskType: string;
    confidence: number;
    missingInfo: string[];
  } {
    const title = issue.title.toLowerCase();
    const body = issue.body.toLowerCase();
    const content = title + ' ' + body;
    const missingInfo: string[] = [];

    let taskType = 'generic';
    let confidence = 30; // Base confidence

    // Analyze task type
    if (this.containsAny(content, ['bug', 'fix', 'error', 'crash', 'broken', 'fails'])) {
      taskType = 'bug_fix';
      confidence = 70;
    } else if (this.containsAny(content, ['feature', 'add', 'implement', 'new', 'support'])) {
      taskType = 'feature';
      confidence = 65;
    } else if (this.containsAny(content, ['doc', 'readme', 'comment', 'docs'])) {
      taskType = 'documentation';
      confidence = 80;
    } else if (this.containsAny(content, ['refactor', 'cleanup', 'improve', 'restructure'])) {
      taskType = 'refactor';
      confidence = 60;
    }

    // Check for missing critical information
    if (body.length < 20) {
      missingInfo.push('Description is too brief');
    }

    if (taskType === 'bug_fix') {
      if (!this.containsAny(content, ['where', 'file', 'location', 'path', 'line'])) {
        missingInfo.push('File/Location not specified');
      }
      if (!this.containsAny(content, ['expected', 'should', 'when'])) {
        missingInfo.push('Expected behavior not described');
      }
      if (!this.containsAny(content, ['actual', 'result', 'happens'])) {
        missingInfo.push('Actual behavior not described');
      }
    }

    if (taskType === 'feature') {
      if (!this.containsAny(content, ['should', 'would', 'want', 'need', 'allow'])) {
        missingInfo.push('Purpose/Use case not described');
      }
    }

    if (taskType === 'generic') {
      missingInfo.push('Cannot determine task type from title/body');
    }

    // Adjust confidence based on missing info
    confidence = Math.max(10, confidence - missingInfo.length * 15);

    return { taskType, confidence, missingInfo };
  }

  private containsAny(text: string, words: string[]): boolean {
    return words.some((word) => text.includes(word));
  }

  private async askForClarification(
    issue: Issue,
    analysis: { taskType: string; confidence: number; missingInfo: string[] },
    dryRun: boolean
  ): Promise<void> {
    if (dryRun) {
      console.log('[DRY RUN] Would ask for clarification:');
      console.log(`   Missing: ${analysis.missingInfo.join(', ')}`);
      return;
    }

    const questions = this.generateQuestions(issue, analysis);

    const comment = this.buildClarificationComment(questions);

    await this.client.addComment(issue.number, comment);
    await this.client.removeLabel(issue.number, config.labels.implementing);
    await this.client.addLabels(issue.number, [config.labels.blocked]);

    console.log(`❓ Asked ${questions.length} question(s) for clarification`);
  }

  private generateQuestions(
    issue: Issue,
    analysis: { taskType: string; confidence: number; missingInfo: string[] }
  ): string[] {
    const questions: string[] = [];

    for (const missing of analysis.missingInfo) {
      switch (missing) {
        case 'Description is too brief':
          questions.push(`Could you provide more details about what you'd like to achieve?`);
          break;
        case 'File/Location not specified':
          questions.push(`Which file(s) or location(s) does this issue refer to?`);
          break;
        case 'Expected behavior not described':
          questions.push(`What should happen when this works correctly?`);
          break;
        case 'Actual behavior not described':
          questions.push(`What currently happens that's incorrect?`);
          break;
        case 'Purpose/Use case not described':
          questions.push(`What's the use case or benefit of this feature?`);
          break;
        case 'Cannot determine task type from title/body':
          questions.push(`Could you clarify what type of change this is? (bug fix, feature, refactor, documentation, etc.)`);
          break;
      }
    }

    // Add context-specific questions based on task type
    if (analysis.taskType === 'bug_fix' && questions.length < 2) {
      questions.push(`Steps to reproduce the issue would be helpful.`);
    }

    if (analysis.taskType === 'feature' && questions.length < 2) {
      questions.push(`Could you provide examples or pseudo-code of how this should work?`);
    }

    return questions;
  }

  private buildClarificationComment(questions: string[]): string {
    return `🤖 **Agent Clarification Needed**

I've started analyzing this issue, but I need some clarification before I can proceed with the implementation.

**Questions:**

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

---

Please answer these questions so I can create an accurate solution. Once you provide more details, I can:
- Identify the exact files that need changes
- Implement the solution correctly
- Create a proper Pull Request

Thanks! 🙏`;
  }

  private async implementTask(issue: Issue, taskType: string, dryRun: boolean): Promise<FileChange[]> {
    console.log(`⚙️ Implementing ${taskType} task...`);

    switch (taskType) {
      case 'bug_fix':
        return this.handleBugFix(issue, dryRun);
      case 'feature':
        return this.handleFeature(issue, dryRun);
      case 'documentation':
        return this.handleDocumentation(issue, dryRun);
      case 'refactor':
        return this.handleRefactor(issue, dryRun);
      default:
        return this.handleGeneric(issue, dryRun);
    }
  }

  private async handleBugFix(issue: Issue, dryRun: boolean): Promise<FileChange[]> {
    console.log('📋 Implementing: Bug fix');

    // Extract file path from issue if mentioned
    const filePath = this.extractFilePath(issue);
    const repoPath = this.client.getRepoPath();
    const changes: FileChange[] = [];

    if (filePath && fs.existsSync(path.join(repoPath, filePath))) {
      // Modify the specific file
      const fullPath = path.join(repoPath, filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // For now, create a patch file documenting the fix
      const patchContent = `# Bug Fix for Issue #${issue.number}

## Title
${issue.title}

## Description
${issue.body}

## File to Fix
\`${filePath}\`

## Proposed Fix
<!-- TODO: Add specific code changes here -->

## Expected Behavior
${this.extractExpectedBehavior(issue.body)}

## Actual Behavior  
${this.extractActualBehavior(issue.body)}
`;

      if (!dryRun) {
        const patchesDir = path.join(repoPath, '.agent-patches');
        if (!fs.existsSync(patchesDir)) {
          fs.mkdirSync(patchesDir, { recursive: true });
        }
        fs.writeFileSync(path.join(patchesDir, `issue-${issue.number}.md`), patchContent);
      }

      changes.push({
        path: `.agent-patches/issue-${issue.number}.md`,
        content: patchContent,
        operation: 'create',
      });
    }

    // Always create a solution doc
    changes.push(...(await this.handleGeneric(issue, dryRun)));

    return changes;
  }

  private async handleFeature(issue: Issue, dryRun: boolean): Promise<FileChange[]> {
    console.log('📋 Implementing: Feature request');
    // TODO: Implement feature detection and generation
    return this.handleGeneric(issue, dryRun);
  }

  private async handleDocumentation(issue: Issue, dryRun: boolean): Promise<FileChange[]> {
    console.log('📋 Implementing: Documentation');
    const changes: FileChange[] = [];
    const repoPath = this.client.getRepoPath();
    const readmePath = path.join(repoPath, 'README.md');

    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf-8');
      const newContent = content + `\n\n## ${issue.title}\n\n${issue.body}\n`;

      if (!dryRun) {
        fs.writeFileSync(readmePath, newContent);
      }

      changes.push({
        path: 'README.md',
        content: newContent,
        operation: 'modify',
      });
    }

    return changes;
  }

  private async handleRefactor(issue: Issue, dryRun: boolean): Promise<FileChange[]> {
    console.log('📋 Implementing: Refactoring');
    // TODO: Implement refactoring detection
    return this.handleGeneric(issue, dryRun);
  }

  private async handleGeneric(issue: Issue, dryRun: boolean): Promise<FileChange[]> {
    console.log('📋 Creating solution document');
    const changes: FileChange[] = [];
    const repoPath = this.client.getRepoPath();

    const solutionContent = `# Solution for Issue #${issue.number}

## Title
${issue.title}

## Description
${issue.body}

## Author
@${issue.author}

## Task Type
${this.identifyTaskType(issue)}

## Implementation Plan
<!-- TODO: Fill in implementation details -->

## Files to Modify
<!-- TODO: List files that need changes -->

## Testing Plan
<!-- TODO: How to verify the solution works -->
`;

    const solutionsDir = path.join(repoPath, 'solutions');
    const solutionPath = path.join(solutionsDir, `issue-${issue.number}.md`);

    if (!dryRun) {
      if (!fs.existsSync(solutionsDir)) {
        fs.mkdirSync(solutionsDir, { recursive: true });
      }
      fs.writeFileSync(solutionPath, solutionContent);
    }

    changes.push({
      path: `solutions/issue-${issue.number}.md`,
      content: solutionContent,
      operation: 'create',
    });

    return changes;
  }

  private identifyTaskType(issue: Issue): string {
    const content = (issue.title + ' ' + issue.body).toLowerCase();

    if (this.containsAny(content, ['bug', 'fix', 'error', 'crash', 'broken', 'fails'])) {
      return 'Bug Fix';
    }
    if (this.containsAny(content, ['feature', 'add', 'implement', 'new', 'support'])) {
      return 'Feature Request';
    }
    if (this.containsAny(content, ['doc', 'readme', 'comment', 'docs'])) {
      return 'Documentation';
    }
    if (this.containsAny(content, ['refactor', 'cleanup', 'improve', 'restructure'])) {
      return 'Refactoring';
    }
    return 'General';
  }

  private extractFilePath(issue: Issue): string | null {
    const patterns = [
      /`([^`]+)`/, // Backtick quoted
      /([/\w]+\.\w+)/, // File path patterns
    ];

    for (const pattern of patterns) {
      const match = issue.body.match(pattern);
      if (match) {
        const file = match[1] || match[0];
        if (file.includes('/') || /\.\w+$/.test(file)) {
          return file;
        }
      }
    }
    return null;
  }

  private extractExpectedBehavior(body: string): string {
    const patterns = [
      /should\s+(.+)/i,
      /expected\s+(.+)/i,
      /when\s+(.+?)(?:\.|$)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) return match[1];
    }
    return 'Not specified';
  }

  private extractActualBehavior(body: string): string {
    const patterns = [
      /actual\s+(.+)/i,
      /currently\s+(.+)/i,
      /but\s+(.+?)(?:\.|$)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) return match[1];
    }
    return 'Not specified';
  }
}
