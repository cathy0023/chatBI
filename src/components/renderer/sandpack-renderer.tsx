'use client';

import {
  SandpackProvider,
  SandpackPreview,
} from '@codesandbox/sandpack-react';

const BASE_DEPS: Record<string, string> = {
  'react': 'latest',
  'react-dom': 'latest',
  'echarts': '6.0.0',
  'echarts-for-react': '3.0.2',
};

const ENTRY_FILE = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
const root = createRoot(document.getElementById("root"));
root.render(<App />);`;

type SandpackRendererProps = {
  code: string;
  dependencies?: Record<string, string>;
};

export function SandpackRenderer({ code, dependencies }: SandpackRendererProps) {
  const allDeps = { ...BASE_DEPS, ...dependencies };

  return (
    <div className="w-full h-[500px] rounded-lg border overflow-hidden">
      <SandpackProvider
        template="react"
        files={{
          '/App.js': code,
          '/index.js': ENTRY_FILE,
        }}
        customSetup={{ dependencies: allDeps }}
        options={{
          recompileMode: 'delayed' as const,
          recompileDelay: 500,
        }}
      >
        <SandpackPreview
          showNavigator={false}
          showRefreshButton={false}
          style={{ height: '100%', border: 'none' }}
        />
      </SandpackProvider>
    </div>
  );
}
