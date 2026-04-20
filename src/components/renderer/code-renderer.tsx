'use client';

import React, { Component, type ReactNode } from 'react';
import { transform } from 'sucrase';

type CodeRendererProps = {
  code: string;
  scope: Record<string, unknown>;
};

type ErrorBoundaryState = {
  error: Error | null;
};

class CodeErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center p-4">
          <div className="text-sm text-red-500 text-center">
            <p className="font-medium mb-1">渲染错误</p>
            <pre className="text-xs whitespace-pre-wrap text-left max-h-48 overflow-auto">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function stripModuleSyntax(code: string): string {
  return code
    // Strip import statements: import X from 'Y' or import { X } from 'Y'
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]*['"];?\s*$/gm, '')
    // Strip side-effect imports: import 'Y'
    .replace(/^import\s+['"][^'"]*['"];?\s*$/gm, '')
    // Strip echarts.use() calls (charts already registered via scope)
    .replace(/echarts\.use\([^)]*\);?/g, '')
    // Strip export default
    .replace(/export\s+default\s+/g, '')
    .trim();
}

function compileAndEvaluate(code: string, scope: Record<string, unknown>) {
  const cleaned = stripModuleSyntax(code);

  const transpiled = transform(cleaned, {
    transforms: ['jsx'],
    jsxRuntime: 'classic',
  }).code;

  const scopeKeys = Object.keys(scope);
  const scopeValues = Object.values(scope);

  const fn = new Function(
    'React',
    ...scopeKeys,
    `${transpiled}\nreturn typeof App === 'function' ? App : undefined;`,
  );

  const Comp = fn(React, ...scopeValues);
  if (!Comp) {
    throw new Error('未找到 App 组件，请使用 function App() { ... } 格式');
  }
  return Comp;
}

export function CodeRenderer({ code, scope }: CodeRendererProps) {
  try {
    const App = compileAndEvaluate(code, scope);
    return (
      <CodeErrorBoundary>
        <App />
      </CodeErrorBoundary>
    );
  } catch (err) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4">
        <div className="text-sm text-red-500 text-center">
          <p className="font-medium mb-1">编译错误</p>
          <pre className="text-xs whitespace-pre-wrap text-left max-h-48 overflow-auto">
            {err instanceof Error ? err.message : String(err)}
          </pre>
        </div>
      </div>
    );
  }
}
