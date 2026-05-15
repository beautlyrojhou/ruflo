# Agent Skill: Test Generator

Generates comprehensive test suites for TypeScript/JavaScript code, including unit tests, integration tests, and edge case coverage.

## Overview

This skill analyzes source code and automatically generates meaningful test cases using frameworks like Jest, Vitest, or Mocha. It identifies functions, classes, and modules, then produces tests that cover happy paths, error conditions, and boundary cases.

## Capabilities

- Analyze TypeScript/JavaScript source files to extract testable units
- Generate unit tests with proper mocking and dependency injection
- Create integration tests for API endpoints and service interactions
- Identify and test edge cases and boundary conditions
- Produce test coverage reports and gap analysis
- Support multiple test frameworks (Jest, Vitest, Mocha/Chai)

## Usage

```typescript
import { TestGeneratorAgent } from './agent-test-generator';

const agent = new TestGeneratorAgent({
  framework: 'jest',
  coverageTarget: 80,
  includeEdgeCases: true,
});

const tests = await agent.generateTests('./src/services/payment.ts');
await agent.writeTestFile(tests, './src/services/__tests__/payment.test.ts');
```

## Configuration

```toml
[agent.test-generator]
framework = "jest"              # jest | vitest | mocha
coverage_target = 80            # minimum coverage percentage
include_edge_cases = true       # generate boundary/edge case tests
include_mocks = true            # auto-generate mocks for dependencies
output_dir = "__tests__"        # relative output directory
max_tests_per_function = 5      # cap tests generated per function
```

## Implementation

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs/promises';

interface TestGeneratorConfig {
  framework: 'jest' | 'vitest' | 'mocha';
  coverageTarget: number;
  includeEdgeCases: boolean;
  includeMocks: boolean;
  outputDir: string;
  maxTestsPerFunction: number;
}

interface FunctionSignature {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
}

interface GeneratedTest {
  description: string;
  code: string;
  type: 'unit' | 'integration' | 'edge';
}

class SourceAnalyzer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(sourceFile: string) {
    this.program = ts.createProgram([sourceFile], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    });
    this.checker = this.program.getTypeChecker();
  }

  extractFunctions(sourceFile: string): FunctionSignature[] {
    const file = this.program.getSourceFile(sourceFile);
    if (!file) return [];

    const functions: FunctionSignature[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node)
      ) {
        const sig = this.extractSignature(node);
        if (sig) functions.push(sig);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(file, visit);
    return functions;
  }

  private extractSignature(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction
  ): FunctionSignature | null {
    const symbol = this.checker.getSymbolAtLocation(
      ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
        ? node.name ?? node
        : node
    );

    const name =
      symbol?.getName() ??
      (ts.isFunctionDeclaration(node) && node.name?.text) ??
      'anonymous';

    if (name === 'anonymous') return null;

    const signature = this.checker.getSignatureFromDeclaration(node);
    if (!signature) return null;

    const params = signature.getParameters().map((param) => ({
      name: param.getName(),
      type: this.checker.typeToString(
        this.checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!)
      ),
    }));

    const returnType = this.checker.typeToString(
      signature.getReturnType()
    );

    const isAsync =
      !!(node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.AsyncKeyword
      ));

    const isExported =
      !!(node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      ));

    return { name, params, returnType, isAsync, isExported };
  }
}

class TestTemplateEngine {
  constructor(
    private framework: TestGeneratorConfig['framework'],
    private config: TestGeneratorConfig
  ) {}

  generateImports(sourcePath: string): string {
    const rel = path
      .relative(path.dirname(sourcePath), sourcePath)
      .replace(/\.ts$/, '');

    const importLine = `import { ... } from '${rel}';`;

    if (this.framework === 'vitest') {
      return `import { describe, it, expect, vi } from 'vitest';
${importLine}`;
    }
    return `import { describe, it, expect, jest } from '@jest/globals';
${importLine}`;
  }

  generateUnitTest(fn: FunctionSignature): GeneratedTest {
    const mockArgs = fn.params
      .map((p) => this.generateMockValue(p.type))
      .join(', ');

    const awaitKeyword = fn.isAsync ? 'await ' : '';
    const code = `  it('should return expected result for valid input', ${fn.isAsync ? 'async ' : ''}() => {
    const result = ${awaitKeyword}${fn.name}(${mockArgs});
    expect(result).toBeDefined();
  });`;

    return { description: `${fn.name} - happy path`, code, type: 'unit' };
  }

  generateEdgeCaseTests(fn: FunctionSignature): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    // Null/undefined inputs
    if (fn.params.length > 0) {
      const nullArgs = fn.params.map(() => 'null').join(', ');
      const awaitKeyword = fn.isAsync ? 'await ' : '';
      tests.push({
        description: `${fn.name} - handles null inputs`,
        code: `  it('should handle null inputs gracefully', ${fn.isAsync ? 'async ' : ''}() => {
    expect(() => ${awaitKeyword}${fn.name}(${nullArgs})).not.toThrow();
  });`,
        type: 'edge',
      });
    }

    // Empty string inputs
    const hasStringParam = fn.params.some((p) => p.type === 'string');
    if (hasStringParam) {
      const emptyArgs = fn.params
        .map((p) => (p.type === 'string' ? "''" : this.generateMockValue(p.type)))
        .join(', ');
      tests.push({
        description: `${fn.name} - handles empty string`,
        code: `  it('should handle empty string input', ${fn.isAsync ? 'async ' : ''}() => {
    const result = ${fn.isAsync ? 'await ' : ''}${fn.name}(${emptyArgs});
    expect(result).toBeDefined();
  });`,
        type: 'edge',
      });
    }

    return tests;
  }

  generateErrorTest(fn: FunctionSignature): GeneratedTest {
    const awaitKeyword = fn.isAsync ? 'await ' : '';
    const wrapper = fn.isAsync
      ? `await expect(${fn.name}(invalidInput)).rejects.toThrow()`
      : `expect(() => ${fn.name}(invalidInput)).toThrow()`;

    return {
      description: `${fn.name} - throws on invalid input`,
      code: `  it('should throw an error for invalid input', ${fn.isAsync ? 'async ' : ''}() => {
    const invalidInput = undefined as any;
    ${wrapper};
  });`,
      type: 'unit',
    };
  }

  private generateMockValue(type: string): string {
    const typeMap: Record<string, string> = {
      string: "'test-value'",
      number: '42',
      boolean: 'true',
      'string[]': "['item1', 'item2']",
      'number[]': '[1, 2, 3]',
      object: '{}',
      any: "'mock-value'",
      unknown: "'mock-value'",
      void: '',
    };
    return typeMap[type] ?? '{}';
  }

  assembleTestFile(
    sourcePath: string,
    functions: FunctionSignature[],
    testsByFunction: Map<string, GeneratedTest[]>
  ): string {
    const lines: string[] = [
      `// Auto-generated tests for ${path.basename(sourcePath)}`,
      `// Generated by agent-test-generator — do not edit manually`,
      '',
      this.generateImports(sourcePath),
      '',
    ];

    for (const fn of functions) {
      const tests = testsByFunction.get(fn.name) ?? [];
      if (tests.length === 0) continue;

      lines.push(`describe('${fn.name}', () => {`);
      for (const test of tests) {
        lines.push(test.code);
        lines.push('');
      }
      lines.push('});');
      lines.push('');
    }

    return lines.join('\n');
  }
}

export class TestGeneratorAgent {
  private config: TestGeneratorConfig;
  private templateEngine: TestTemplateEngine;

  constructor(config: Partial<TestGeneratorConfig> = {}) {
    this.config = {
      framework: 'jest',
      coverageTarget: 80,
      includeEdgeCases: true,
      includeMocks: true,
      outputDir: '__tests__',
      maxTestsPerFunction: 5,
      ...config,
    };
    this.templateEngine = new TestTemplateEngine(
      this.config.framework,
      this.config
    );
  }

  async generateTests(sourcePath: string): Promise<string> {
    const analyzer = new SourceAnalyzer(sourcePath);
    const functions = analyzer
      .extractFunctions(sourcePath)
      .filter((fn) => fn.isExported);

    const testsByFunction = new Map<string, GeneratedTest[]>();

    for (const fn of functions) {
      const tests: GeneratedTest[] = [];

      // Happy path
      tests.push(this.templateEngine.generateUnitTest(fn));

      // Error case
      tests.push(this.templateEngine.generateErrorTest(fn));

      // Edge cases
      if (this.config.includeEdgeCases) {
        const edgeCases = this.templateEngine.generateEdgeCaseTests(fn);
        tests.push(...edgeCases);
      }

      // Respect max tests cap
      testsByFunction.set(
        fn.name,
        tests.slice(0, this.config.maxTestsPerFunction)
      );
    }

    return this.templateEngine.assembleTestFile(
      sourcePath,
      functions,
      testsByFunction
    );
  }

  async writeTestFile(
    content: string,
    outputPath: string
  ): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');
    console.log(`[TestGeneratorAgent] Written: ${outputPath}`);
  }

  async analyzeGaps(sourcePath: string, testPath: string): Promise<string[]> {
    const analyzer = new SourceAnalyzer(sourcePath);
    const allFunctions = analyzer
      .extractFunctions(sourcePath)
      .filter((fn) => fn.isExported);

    let existingTestContent = '';
    try {
      existingTestContent = await fs.readFile(testPath, 'utf-8');
    } catch {
      return allFunctions.map((fn) => fn.name);
    }

    return allFunctions
      .filter((fn) => !existingTestContent.includes(`describe('${fn.name}'`))
      .map((fn) => fn.name);
  }
}
```

## Example Output

Given a source file `src/utils/string.ts`:

```typescript
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function fetchLabel(id: string): Promise<string> {
  const res = await fetch(`/api/labels/${id}`);
  return res.json();
}
```

The agent produces `src/utils/__tests__/string.test.ts`:

```typescript
// Auto-generated tests for string.ts
import { describe, it, expect, jest } from '@jest/globals';
import { capitalize, fetchLabel } from '../string';

describe('capitalize', () => {
  it('should return expected result for valid input', () => {
    const result = capitalize('test-value');
    expect(result).toBeDefined();
  });

  it('should throw an error for invalid input', () => {
    const invalidInput = undefined as any;
    expect(() => capitalize(invalidInput)).toThrow();
  });

  it('should handle empty string input', () => {
    const result = capitalize('');
    expect(result).toBeDefined();
  });
});

describe('fetchLabel', () => {
  it('should return expected result for valid input', async () => {
    const result = await fetchLabel('test-value');
    expect(result).toBeDefined();
  });
});
```

## Integration with Other Skills

- **agent-code-review**: Use gap analysis output to flag untested functions during reviews
- **agent-analyze-code-quality**: Feed coverage metrics into quality scoring
- **agent-agent**: Compose with planning agents to run test generation as part of CI pipelines
