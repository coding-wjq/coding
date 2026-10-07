const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { streamText, tool, stepCountIs } = require('ai');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const { z } = require('zod');

dotenv.config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

const deepseek = createOpenAICompatible({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

app.post('/api/chat', async (req, res) => {
  console.log('[后端] 收到请求:', JSON.stringify(req.body));
  const { messages } = req.body;

  // 手动构造发给 DeepSeek 的请求体
  const deepseekPayload = {
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: `你是运行在浏览器沙盒中的 AI 助手。沙盒环境是 Node.js，只支持纯 JavaScript 代码。

调用 run_python 工具时，code 参数必须满足：
1. 是纯粹的、可直接执行的 JavaScript 代码。
2. 不要包裹在字符串里，不要用 Python 语法，不要写 print()。
3. 不要包含 Markdown 代码块标记（不要写 \`\`\`）。
4. 不要包含中文注释或说明文字，只保留可执行代码。
5. 代码必须以 function、const、let、console 或 // 开头。

示例（参考格式）：
const result = [];
let a = 0, b = 1;
for (let i = 0; i < 10; i++) {
  result.push(a);
  [a, b] = [b, a + b];
}
console.log(result);`
      },
      ...messages
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'run_python',
        description: '在浏览器沙盒中执行 Python 代码',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        }
      }
    }],
    stream: true
  };

  try {
    const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(deepseekPayload)
    });

    if (!dsRes.ok) {
      const errText = await dsRes.text();
      res.write(`data: ${JSON.stringify({ type: 'error', errorText: errText })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = dsRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall = { name: '', argsStr: '' };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue; // DeepSeek 自己会发 [DONE]，先忽略

        try {
          const chunk = JSON.parse(raw);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // 1. 普通文本流
          if (delta.content) {
            res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: delta.content })}\n\n`);
          }

          // 2. 工具调用流
          if (delta.tool_calls) {
  for (const tc of delta.tool_calls) {
    // 累积工具名
    if (tc.function?.name) {
      currentToolCall.name = tc.function.name;
    }
    // 累积参数片段（DeepSeek 是分片流式传输的）
    if (tc.function?.arguments) {
      currentToolCall.argsStr += tc.function.arguments;
    }
  }
}
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
    // 流结束后，把累积完整的工具调用一次性发给前端
if (currentToolCall.name) {
  let parsedArgs = {};
  try {
    parsedArgs = JSON.parse(currentToolCall.argsStr || '{}');
  } catch (e) {
    console.error('[工具参数解析失败]', currentToolCall.argsStr);
  }
  res.write(`data: ${JSON.stringify({
    type: 'tool-call',
    toolName: currentToolCall.name,
    args: parsedArgs
  })}\n\n`);
}
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[后端错误]', err);
    res.write(`data: ${JSON.stringify({ type: 'error', errorText: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});
app.post('/api/tool-result', async (req, res) => {
  console.log('[后端] 收到工具结果:', JSON.stringify(req.body));
  const { originalQuestion, toolName, toolArgs, toolResult } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 构造标准的工具调用历史（user → assistant(tool_calls) → tool(result)）
  const messages = [
    { role: 'user', content: originalQuestion },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(toolArgs)
        }
      }]
    },
    {
      role: 'tool',
      tool_call_id: 'call_1',
      content: toolResult
    }
  ];

  try {
    const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: true
      })
    });

    const reader = dsRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: delta.content })}\n\n`);
          }
        } catch (e) {}
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[后端错误]', err);
    res.write(`data: ${JSON.stringify({ type: 'error', errorText: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Vercel Serverless 部署
module.exports = app;

// 本地开发时才监听端口
if (require.main === module) {
  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
}