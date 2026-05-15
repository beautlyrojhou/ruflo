# Agent: Documentation Generator

## Overview
Automatically generates and maintains project documentation from source code, including API references, README files, and inline documentation suggestions.

## Capabilities
- Parse TypeScript/JavaScript source files to extract type signatures, function signatures, and class definitions
- Generate JSDoc/TSDoc comments for undocumented code
- Produce Markdown documentation for modules, classes, and functions
- Identify missing or outdated documentation
- Suggest documentation improvements based on code complexity

## Skill Definition

```typescript
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a parsed documentation entry extracted from source code.
 */
interface DocEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  description?: string;
  params?: ParamEntry[];
  returns?: string;
  examples?: string[];
  filePath: string;
  lineNumber: number;
}

interface ParamEntry {
  name: string;
  type: string;
  description?: string;
  optional: boolean;
}

/**
 * Analyzes TypeScript source files and extracts documentation-relevant metadata.
 */
class SourceDocAnalyzer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(rootFiles: string[], compilerOptions: ts.CompilerOptions = {}) {
    this.program = ts.createProgram(rootFiles, {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      ...compilerOptions,
    });
    this.checker = this.program.getTypeChecker();
  }

  /**
   * Extracts all doc entries from the provided source file.
   */
  extractEntries(sourceFile: ts.SourceFile): DocEntry[] {
    const entries: DocEntry[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        entries.push(this.buildFunctionEntry(node, sourceFile));
      } else if (ts.isClassDeclaration(node) && node.name) {
        entries.push(this.buildClassEntry(node, sourceFile));
      } else if (ts.isInterfaceDeclaration(node)) {
        entries.push(this.buildInterfaceEntry(node, sourceFile));
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return entries;
  }

  private buildFunctionEntry(node: ts.FunctionDeclaration, sf: ts.SourceFile): DocEntry {
    const symbol = node.name ? this.checker.getSymbolAtLocation(node.name) : undefined;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    const jsDoc = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(this.checker)) : '';

    return {
      name: node.name?.text ?? 'anonymous',
      kind: 'function',
      description: jsDoc || undefined,
      params: node.parameters.map((p) => ({
        name: p.name.getText(sf),
        type: p.type ? p.type.getText(sf) : 'unknown',
        optional: !!p.questionToken || !!p.initializer,
      })),
      returns: node.type?.getText(sf),
      filePath: sf.fileName,
      lineNumber: line + 1,
    };
  }

  private buildClassEntry(node: ts.ClassDeclaration, sf: ts.SourceFile): DocEntry {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    return {
      name: node.name?.text ?? 'AnonymousClass',
      kind: 'class',
      filePath: sf.fileName,
      lineNumber: line + 1,
    };
  }

  private buildInterfaceEntry(node: ts.InterfaceDeclaration, sf: ts.SourceFile): DocEntry {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    return {
      name: node.name.text,
      kind: 'interface',
      filePath: sf.fileName,
      lineNumber: line + 1,
    };
  }
}

/**
 * Renders DocEntry objects into Markdown documentation strings.
 */
class MarkdownDocRenderer {
  /**
   * Renders a full module documentation page from a list of doc entries.
   */
  renderModule(moduleName: string, entries: DocEntry[]): string {
    const lines: string[] = [`# ${moduleName}\n`];

    const grouped = this.groupByKind(entries);

    for (const [kind, items] of Object.entries(grouped)) {
      lines.push(`## ${capitalize(kind)}s\n`);
      for (const entry of items) {
        lines.push(this.renderEntry(entry));
      }
    }

    return lines.join('\n');
  }

  private renderEntry(entry: DocEntry): string {
    const lines: string[] = [`### \`${entry.name}\``];
    if (entry.description) lines.push(`\n${entry.description}`);
    if (entry.params?.length) {
      lines.push('\n**Parameters:**');
      for (const p of entry.params) {
        const opt = p.optional ? '_(optional)_' : '';
        lines.push(`- \`${p.name}\` (\`${p.type}\`) ${opt}${p.description ? ' — ' + p.description : ''}`);
      }
    }
    if (entry.returns) lines.push(`\n**Returns:** \`${entry.returns}\``);
    lines.push(`\n> _Defined in \`${entry.filePath}:${entry.lineNumber}\`_\n`);
    return lines.join('\n');
  }

  private groupByKind(entries: DocEntry[]): Record<string, DocEntry[]> {
    return entries.reduce((acc, e) => {
      (acc[e.kind] = acc[e.kind] ?? []).push(e);
      return acc;
    }, {} as Record<string, DocEntry[]>);
  }
}

/**
 * Identifies undocumented symbols and returns suggestions.
 */
function findUndocumentedEntries(entries: DocEntry[]): DocEntry[] {
  return entries.filter((e) => !e.description || e.description.trim() === '');
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

## Usage

```typescript
const analyzer = new SourceDocAnalyzer(['src/index.ts', 'src/utils.ts']);
const renderer = new MarkdownDocRenderer();

for (const sf of analyzer['program'].getSourceFiles()) {
  if (!sf.isDeclarationFile) {
    const entries = analyzer.extractEntries(sf);
    const moduleName = path.basename(sf.fileName, '.ts');
    const markdown = renderer.renderModule(moduleName, entries);
    fs.writeFileSync(`docs/${moduleName}.md`, markdown);

    const missing = findUndocumentedEntries(entries);
    if (missing.length > 0) {
      console.warn(`[doc-gen] ${missing.length} undocumented symbol(s) in ${sf.fileName}`);
    }
  }
}
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `outputDir` | `string` | `docs/` | Directory to write generated Markdown files |
| `includePrivate` | `boolean` | `false` | Whether to document private class members |
| `warnOnMissing` | `boolean` | `true` | Emit warnings for undocumented symbols |
| `tsConfigPath` | `string` | `tsconfig.json` | Path to the TypeScript configuration file |

## Integration

This skill integrates with:
- **agent-code-review**: Shares AST parsing utilities and symbol extraction logic
- **agent-test-generator**: Leverages `SourceAnalyzer` output to cross-reference test coverage with documentation gaps
- **agent-analyze-code-quality**: Feeds documentation coverage metrics into quality scoring
