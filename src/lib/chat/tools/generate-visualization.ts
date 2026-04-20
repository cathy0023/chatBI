import { z } from 'zod';
import { tool, zodSchema } from 'ai';

const inputSchema = z.object({
  title: z.string().describe('可视化页面标题'),
  description: z.string().describe('简要描述这个可视化展示了什么'),
  code: z.string().describe(
    '完整的 React 组件代码。要求：\n' +
    '1. function App() { ... } 格式（不加 export default）\n' +
    '2. 不要写 import 语句，echarts 和 ReactECharts 已在环境中可用\n' +
    '3. 不要写 echarts.use() 调用，图表组件已注册\n' +
    '4. 使用 <ReactECharts echarts={echarts} option={option} /> 渲染图表\n' +
    '5. 数据直接内嵌在代码中\n' +
    '6. 组件必须自包含，不依赖外部变量'
  ),
  dependencies: z.record(z.string(), z.string()).optional().describe(
    '代码需要的额外 npm 依赖，格式 { "package-name": "version" }。' +
    '注意：react, react-dom, echarts, echarts-for-react 已预装，无需重复声明。'
  ),
});

export const generateVisualization = tool({
  description:
    '生成数据可视化页面。根据数据特征生成 React + ECharts 代码，在沙箱中渲染。' +
    '支持任意图表类型、多图组合、自定义布局。优先使用 ECharts 实现可视化。',

  inputSchema: zodSchema(inputSchema),

  execute: async (params: {
    title: string;
    description: string;
    code: string;
    dependencies?: Record<string, string>;
  }) => {
    const code = params.code.trim();
    if (code.length < 20) {
      return { error: '生成的代码过短，请重新生成' };
    }
    if (code.length > 50000) {
      return { error: '代码超过 50KB 限制' };
    }
    const extraDeps = params.dependencies ?? {};
    if (Object.keys(extraDeps).length > 5) {
      return { error: '额外依赖不能超过 5 个，请优先使用已预装的库' };
    }
    return {
      type: 'visualization' as const,
      title: params.title,
      description: params.description,
      code,
      dependencies: extraDeps,
    };
  },
});
