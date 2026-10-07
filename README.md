# WebContainer MCP Sandbox Agent

一个运行在浏览器沙盒中的 AI Agent，通过 DeepSeek 大模型调用 MCP 工具，在浏览器端 WebContainer 隔离环境中执行代码，形成完整的多步工具调用闭环。

## 🎯 项目亮点

- **零后端算力**：代码执行完全在用户浏览器的 WebContainer 里完成，后端只负责 LLM 代理和流式传输。
- **浏览器沙盒隔离**：每个用户的执行环境天然隔离，互不干扰。
- **Agent 多步工具调用**：`用户输入 → LLM 调工具 → 浏览器沙盒执行 → 结果回传 → LLM 总结` 完整闭环。
- **执行链路可视化**：右侧 Trace 面板实时展示 Agent 的思考过程、工具调用、沙盒执行日志。

## 🏗️ 系统架构
┌──────────────┐ SSE ┌──────────────┐ HTTP ┌──────────────┐
│ 前端页面 │ ────────▶ │ 后端 API │ ────────▶ │ DeepSeek │
│ index.html │ ◀──────── │ server.js │ ◀──────── │ LLM API │
└──────────────┘ └──────────────┘ └──────────────┘
│
│ tool-call
▼
┌──────────────────────────────────────────────┐
│ 浏览器 WebContainer 沙盒（WebAssembly 隔离） │
│ - 接收 LLM 生成的代码 │
│ - 在用户本地执行 │
│ - stdout/stderr 回传到 Trace 面板 │
└──────────────────────────────────────────────┘

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML/CSS/JS + ESM |
| 沙盒 | @webcontainer/api |
| 后端 | Node.js + Express |
| LLM | DeepSeek Chat Completions API |
| 通信 | SSE（Server-Sent Events）流式传输 |
| 工具协议 | OpenAI Function Calling 格式 |

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install express cors dotenv