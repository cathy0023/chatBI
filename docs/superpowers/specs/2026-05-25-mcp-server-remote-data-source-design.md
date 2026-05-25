# MCP Server for ChatBI Remote Data Source

## Problem

ChatBI 当前数据源是硬编码的本地 SQLite（`chatbi.db` / `sales_performance` 表）。需要接入已有项目（MGV AI）的远程 REST API 数据源，让 ChatBI Agent 能查询和分析远程业务数据。

## Decision

方案 C：语义数据源（MCP Server 封装 API，暴露 schema + 数据获取接口，ChatBI Agent 通过 MCP Client 调用）。

## Architecture

```
cy-test/
  chatBI/          ← 现有项目（加 MCP Client + 新 tools）
  mcp-server/      ← 新项目（独立 Node.js 进程，封装 MGV AI API）
```

两个项目职责分明：

- **mcp-server**: 维护 Cookie/Session 认证，调用 MGV AI API，数据扁平化转换，通过 MCP 协议暴露 tools
- **chatBI**: MCP Client 连接 mcp-server，新增 listSourcesTool / describeSourceTool，queryTool 增加走 MCP 路径的分支

## MCP Server Design

### Project Structure

```
mcp-server/
  package.json              ← @modelcontextprotocol/sdk, node-fetch
  tsconfig.json
  .env                      ← API_BASE_URL, LOGIN_URL, USERNAME, PASSWORD, PORT
  src/
    index.ts                ← MCP Server 入口：注册 tools，启动 HTTP transport
    tools/
      list-team-members.ts  ← 查组织树，获取人员 ID 列表
      list-columns.ts       ← 获取可用指标列（header config）
      fetch-data.ts         ← 主数据获取 + 扁平化转换
    auth/
      session-manager.ts    ← Cookie/Session 生命周期：登录、缓存、401 重登
    transform/
      flatten.ts            ← header+table 嵌套结构 → 扁平 Record[] 转换
    config/
      sources.ts            ← 数据源配置表
    types.ts                ← 共享类型
```

### 3 MCP Tools

#### 1. list_team_members

```
输入: { tree_id?: number }
流程: 调 MGV AI 组织树 API → 返回人员列表
输出: [
  { id: 15039, name: "ly99", tree_name: "深维智信No.1", type: 2 },
  ...
]
```

用途：LLM 先调这个 tool 知道有哪些人/团队，然后按需传 row_ids 给 fetch_data。

#### 2. list_columns

```
输入: { config_id: number, kanban_id: number }
流程:  MGV AI 主数据接口（只取 header 部分）→ 返回指标定义
输出: [
  { name: "成单服务期", key: "deal", description: "成单服务期指标" },
  { name: "加微数", key: "wechat_added", description: "加微数量" },
  ...
]
```

用途：LLM 调这个 tool 知道有哪些指标列，决定查哪些指标。

#### 3. fetch_data

```
输入: {
  config_id: number,       ← 预定义报表配置 ID
  kanban_id: number,       ← 看板 ID
  row_ids?: number[],      ← 人员 ID（可选，不传则自动调组织树拿全量）
  date?: [string, string], ← 日期范围（可选）
  tree_ids?: number[],     ← 部门 ID（可选）
}
流程:
  1. 若无 row_ids → 调组织树 API 获取人员列表
  2. 调 /webapi/bi/team/analysis/column_data（POST，带 Cookie）
  3. flatten.ts: 把 header+table 嵌套结构转成扁平 Record[]
输出: {
  records: [{ name: "ly99", tree_name: "深维智信No.1", 成单服务期: -1 }, ...],
  columns: ["name", "tree_name", "成单服务期", ...],
  total: 300
}
```

### Data Flattening (transform/flatten.ts)

MGV AI API 返回的数据结构：

```json
{
  "header": [{ config: { name: "成单服务期", ... }, value: -1 }],
  "table":  [{ name: "ly99", values: [{ value: -1 }] }]
}
```

转换规则：

```typescript
// header[i].config.name → 成为扁平对象的列名
// table[j].values[i].value → 成为扁平对象的值
// table[j].name, table[j].tree_name → 直接保留为列

function flatten(apiResponse): { records, columns } {
  const columnNames = apiResponse.header.map(h => h.config.name);
  const records = apiResponse.table.map(row => {
    const flat: Record<string, unknown> = {
      name: row.name,
      tree_name: row.tree_name,
    };
    row.values.forEach((v, i) => {
      flat[columnNames[i]] = v.value === -1 ? null : v.value;
      flat[columnNames[i] + '_ratio'] = v.ratio === -1 ? null : v.ratio;
    });
    return flat;
  });
  const columns = ['name', 'tree_name', ...columnNames, ...columnNames.map(n => n + '_ratio')];
  return { records, columns };
}
```

### Authentication (auth/session-manager.ts)

MGV AI 使用 Cookie/Session 认证：

```
登录: POST LOGIN_URL { username, password } → Set-Cookie: access_token=xxx; session=xxx
维护: 所有后续请求自动带上 Cookie header
刷新: 收到 401 → 重新登录 → 重试原请求（最多 1 次）
配置: 凭据从 .env 读取，不硬编码
```

注意：curl 里还有 `X-Token` 和 `X-User-Id` header，session-manager 也要带上这些。

### Startup

```
npx ts-node src/index.ts
→ MCP Server running on http://localhost:3100
→ 自动登录 MGV AI → Session ready
```

## ChatBI Changes

### New Files

```
src/lib/mcp/
  client.ts          ← MCP Client：连接 mcp-server，调用 tools
  config.ts          ← MCP Server 地址配置
```

### Modified Files

```
src/lib/chat/react-executor.ts
  ← 新增 listSourcesTool + describeSourceTool 注册到 tools 对象

src/lib/chat/tools/query-tool.ts
  ← queryTool 增加 MCP 路径分支：当 ctx.dataSource === 'remote' 时走 MCP Client

src/lib/chat/types.ts
  ← ToolContext 增加 dataSource?: 'local' | 'remote' 字段

src/lib/chat/react-gateway.ts
  ← 传递 dataSource 信息到 ToolContext
```

### New Tools in ReAct Loop

```typescript
// react-executor.ts 的 tools 对象从 3 个变成 5 个
const tools = {
  queryTool: createQueryTool(ctx),        // 原有，增加 MCP 分支
  analysisTool: createAnalysisTool(ctx),  // 不变
  chartTool: createChartTool(ctx),        // 不变
  listTeamMembersTool: createListTeamMembersTool(ctx),  // 新增
  listColumnsTool: createListColumnsTool(ctx),          // 新增
};
```

### Tool Execution Flow (Remote Path)

```
用户: "查深维智信No.1团队的成单服务期"
→ LLM 调 listTeamMembersTool → MCP Client → MCP Server → 组织树 API → 返回人员列表
→ LLM 调 listColumnsTool → MCP Client → MCP Server → header API → 返回指标定义
→ LLM 调 queryTool(query, dataSource='remote') → MCP Client → MCP Server → fetch_data → 扁平化数据
→ ctx.data / ctx.columns 写入 → analysisTool / chartTool 跟原来一样处理
```

### What Doesn't Change

- analysisTool — 只操作 ctx.data，不关心数据来源
- chartTool — 同上
- SSE 事件流 — 完全不变
- 前端 use-chat.ts / render-area.tsx — 完全不变
- 本地 SQLite 路径 — queryTool 保留 local 路径作为默认/fallback

## Phased Implementation

### Phase 1: MCP Server 基础（2-3天）

- 创建 mcp-server 项目
- 实现 session-manager（Cookie/Session 认证）
- 实现 fetch_data tool + flatten 转换
- 手动 curl 验证整个链路能跑通

### Phase 2: MCP Client + ChatBI 集成（2-3天）

- 创建 ChatBI 的 MCP Client
- 新增 listTeamMembersTool / listColumnsTool
- queryTool 增加 remote 分支
- 本地联调：ChatBI → MCP Client → MCP Server → MGV AI API

### Phase 3: 生产化（1周）

- 错误处理：MCP 连接失败 → fallback 到本地数据
- 缓存：schema 缓存 5 分钟，避免重复调 list_columns
- stopWhen 从 5 调到 7（多了 2 个新 tool）
- 测试：单元测试 + 集成测试

## Open Questions

1. **config_id / kanban_id 来源**：这些 ID 是预定义的还是需要动态获取？LLM 怎么知道用哪个 ID？
2. **数据量**：300+ 人的全量查询会不会太慢？是否需要分页或限制？
3. **-1 值的含义**：API 返回 value: -1，是"无数据"还是"权限不足"？需要确认后决定转换策略。
4. **其他 API 端点**：MGV AI 还有哪些数据接口可以接入？需要完整梳理。