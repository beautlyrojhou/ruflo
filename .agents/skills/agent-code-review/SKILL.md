# Agent Code Review Skill

This skill enables agents to perform thorough, structured code reviews with actionable feedback, security analysis, and best-practice enforcement.

## Overview

The `CodeReviewAgent` skill provides automated code review capabilities including:
- Static analysis and code smell detection
- Security vulnerability scanning
- Performance bottleneck identification
- Style and convention enforcement
- Constructive feedback generation

## Usage

```typescript
import { CodeReviewAgent } from './agent-code-review';

const reviewer = new CodeReviewAgent({
  language: 'typescript',
  strictness: 'standard',
  focusAreas: ['security', 'performance', 'maintainability'],
});

const report = await reviewer.review({
  files: ['src/auth.ts', 'src/api/routes.ts'],
  context: 'Pull request: Add JWT authentication',
  diffOnly: true,
});

console.log(report.summary);
console.log(report.issues);
```

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `language` | `string` | `'typescript'` | Primary language to review |
| `strictness` | `'lenient' \| 'standard' \| 'strict'` | `'standard'` | How aggressively to flag issues |
| `focusAreas` | `string[]` | all | Limit review scope |
| `ignorePatterns` | `string[]` | `[]` | Glob patterns to skip |
| `maxIssues` | `number` | `50` | Cap on reported issues |

## Core Classes

```typescript
interface ReviewConfig {
  language: string;
  strictness: 'lenient' | 'standard' | 'strict';
  focusAreas: ReviewFocus[];
  ignorePatterns: string[];
  maxIssues: number;
}

type ReviewFocus =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'correctness'
  | 'style'
  | 'testing';

type Severity = 'info' | 'warning' | 'error' | 'critical';

interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  column?: number;
  severity: Severity;
  category: ReviewFocus;
  message: string;
  suggestion?: string;
  ruleId?: string;
  codeSnippet?: string;
}

interface ReviewReport {
  summary: string;
  score: number; // 0-100
  issues: ReviewIssue[];
  stats: {
    critical: number;
    errors: number;
    warnings: number;
    infos: number;
    filesReviewed: number;
    linesReviewed: number;
  };
  approved: boolean;
  recommendations: string[];
  generatedAt: string;
}

class CodeReviewAgent {
  private config: ReviewConfig;
  private analyzers: Map<ReviewFocus, Analyzer>;

  constructor(config: Partial<ReviewConfig> = {}) {
    this.config = {
      language: 'typescript',
      strictness: 'standard',
      focusAreas: ['security', 'performance', 'maintainability', 'correctness', 'style'],
      ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
      maxIssues: 50,
      ...config,
    };
    this.analyzers = this.initializeAnalyzers();
  }

  private initializeAnalyzers(): Map<ReviewFocus, Analyzer> {
    const map = new Map<ReviewFocus, Analyzer>();
    map.set('security', new SecurityAnalyzer(this.config.strictness));
    map.set('performance', new PerformanceAnalyzer(this.config.strictness));
    map.set('maintainability', new MaintainabilityAnalyzer(this.config.strictness));
    map.set('correctness', new CorrectnessAnalyzer(this.config.strictness));
    map.set('style', new StyleAnalyzer(this.config.language, this.config.strictness));
    return map;
  }

  async review(request: ReviewRequest): Promise<ReviewReport> {
    const issues: ReviewIssue[] = [];
    let linesReviewed = 0;

    for (const file of request.files) {
      const content = await this.loadFile(file, request.diffOnly);
      if (!content || this.shouldIgnore(file)) continue;

      linesReviewed += content.split('\n').length;

      for (const focus of this.config.focusAreas) {
        const analyzer = this.analyzers.get(focus);
        if (!analyzer) continue;
        const found = await analyzer.analyze(file, content, request.context);
        issues.push(...found);
      }
    }

    const trimmed = issues
      .sort((a, b) => this.severityWeight(b.severity) - this.severityWeight(a.severity))
      .slice(0, this.config.maxIssues);

    return this.buildReport(trimmed, request.files.length, linesReviewed);
  }

  private severityWeight(s: Severity): number {
    return { critical: 4, error: 3, warning: 2, info: 1 }[s] ?? 0;
  }

  private shouldIgnore(file: string): boolean {
    return this.config.ignorePatterns.some((p) => minimatch(file, p));
  }

  private async loadFile(file: string, diffOnly = false): Promise<string | null> {
    // In real usage this would read from filesystem or git diff
    return null;
  }

  private buildReport(
    issues: ReviewIssue[],
    filesReviewed: number,
    linesReviewed: number,
  ): ReviewReport {
    const stats = {
      critical: issues.filter((i) => i.severity === 'critical').length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
      filesReviewed,
      linesReviewed,
    };

    const score = Math.max(
      0,
      100 - stats.critical * 20 - stats.errors * 10 - stats.warnings * 3 - stats.infos,
    );

    const approved = stats.critical === 0 && stats.errors === 0 && score >= 70;

    const recommendations = this.generateRecommendations(issues);

    return {
      summary: this.generateSummary(stats, score, approved),
      score,
      issues,
      stats,
      approved,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  private generateSummary(
    stats: ReviewReport['stats'],
    score: number,
    approved: boolean,
  ): string {
    const status = approved ? '✅ Approved' : '❌ Changes Requested';
    return (
      `${status} — Score: ${score}/100. ` +
      `Found ${stats.critical} critical, ${stats.errors} errors, ` +
      `${stats.warnings} warnings across ${stats.filesReviewed} file(s).`
    );
  }

  private generateRecommendations(issues: ReviewIssue[]): string[] {
    const categories = [...new Set(issues.map((i) => i.category))];
    return categories.map((c) => {
      const count = issues.filter((i) => i.category === c).length;
      return `Address ${count} ${c} issue(s) to improve overall code quality.`;
    });
  }
}
```

## Analyzer Interface

```typescript
interface ReviewRequest {
  files: string[];
  context?: string;
  diffOnly?: boolean;
}

abstract class Analyzer {
  constructor(protected strictness: ReviewConfig['strictness']) {}
  abstract analyze(file: string, content: string, context?: string): Promise<ReviewIssue[]>;
}

class SecurityAnalyzer extends Analyzer {
  private patterns = [
    { regex: /eval\s*\(/, message: 'Avoid eval() — potential code injection risk.', severity: 'critical' as Severity },
    { regex: /dangerouslySetInnerHTML/, message: 'dangerouslySetInnerHTML can lead to XSS.', severity: 'error' as Severity },
    { regex: /console\.log\(.*password/i, message: 'Possible password leak via console.log.', severity: 'critical' as Severity },
    { regex: /Math\.random\(\)/, message: 'Math.random() is not cryptographically secure.', severity: 'warning' as Severity },
  ];

  async analyze(file: string, content: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const p of this.patterns) {
        if (p.regex.test(lines[i])) {
          issues.push({
            id: `sec-${i}-${p.severity}`,
            file,
            line: i + 1,
            severity: p.severity,
            category: 'security',
            message: p.message,
            codeSnippet: lines[i].trim(),
          });
        }
      }
    }
    return issues;
  }
}

class PerformanceAnalyzer extends Analyzer {
  async analyze(file: string, content: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\.forEach\(.*await/.test(lines[i])) {
        issues.push({
          id: `perf-${i}`,
          file,
          line: i + 1,
          severity: 'warning',
          category: 'performance',
          message: 'Avoid await inside forEach; use Promise.all with .map() instead.',
          suggestion: 'await Promise.all(items.map(async (item) => { ... }));',
          codeSnippet: lines[i].trim(),
        });
      }
    }
    return issues;
  }
}

class MaintainabilityAnalyzer extends Analyzer {
  async analyze(file: string, content: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    // Flag functions longer than 50 lines
    let fnStart = -1;
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(async\s+)?function|=>\s*\{/.test(lines[i])) {
        fnStart = i;
        braceDepth = 0;
      }
      braceDepth += (lines[i].match(/\{/g) || []).length;
      braceDepth -= (lines[i].match(/\}/g) || []).length;
      if (fnStart >= 0 && braceDepth <= 0) {
        const length = i - fnStart;
        if (length > 50) {
          issues.push({
            id: `maint-fn-${fnStart}`,
            file,
            line: fnStart + 1,
            severity: 'warning',
            category: 'maintainability',
            message: `Function is ${length} lines long. Consider breaking it into smaller functions.`,
          });
        }
        fnStart = -1;
      }
    }
    return issues;
  }
}

class CorrectnessAnalyzer extends Analyzer {
  async analyze(file: string, content: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/==(?!=)/.test(lines[i]) && !/==>/.test(lines[i])) {
        issues.push({
          id: `corr-eq-${i}`,
          file,
          line: i + 1,
          severity: this.strictness === 'strict' ? 'error' : 'warning',
          category: 'correctness',
          message: 'Use === instead of == for strict equality comparison.',
          suggestion: 'Replace == with ===',
          codeSnippet: lines[i].trim(),
        });
      }
    }
    return issues;
  }
}

class StyleAnalyzer extends Analyzer {
  constructor(
    private language: string,
    strictness: ReviewConfig['strictness'],
  ) {
    super(strictness);
  }

  async analyze(file: string, content: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 120) {
        issues.push({
          id: `style-len-${i}`,
          file,
          line: i + 1,
          severity: 'info',
          category: 'style',
          message: `Line exceeds 120 characters (${lines[i].length}). Consider breaking it up.`,
        });
      }
      if (/\s+$/.test(lines[i])) {
        issues.push({
          id: `style-ws-${i}`,
          file,
          line: i + 1,
          severity: 'info',
          category: 'style',
          message: 'Trailing whitespace detected.',
        });
      }
    }
    return issues;
  }
}
```

## Integration with ruflo Agents

This skill integrates with the `agent-adaptive-coordinator` to route review tasks based on workload and with `agent-analyze-code-quality` for deeper static analysis passes.

```typescript
// Example: wiring into the ruflo agent pipeline
import { AdaptiveCoordinator } from '../agent-adaptive-coordinator';
import { CodeReviewAgent } from '../agent-code-review';

const coordinator = new AdaptiveCoordinator();
coordinator.registerSkill('code-review', new CodeReviewAgent({ strictness: 'strict' }));
```

## Output Example

```json
{
  "summary": "❌ Changes Requested — Score: 62/100. Found 1 critical, 2 errors, 5 warnings across 3 file(s).",
  "score": 62,
  "approved": false,
  "stats": {
    "critical": 1,
    "errors": 2,
    "warnings": 5,
    "infos": 3,
    "filesReviewed": 3,
    "linesReviewed": 412
  },
  "recommendations": [
    "Address 1 security issue(s) to improve overall code quality.",
    "Address 5 maintainability issue(s) to improve overall code quality."
  ]
}
```
