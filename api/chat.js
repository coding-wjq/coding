export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  const deepseekPayload = {
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: `你是运行在浏览器沙盒中的 AI 助手。沙盒环境是 Node.js，只支持纯 JavaScript 代码。
调用 run_python 工具时，code 参数必须是纯粹可执行的 JavaScript 代码，不要包裹在字符串里，不要用 Python 语法。`
      },
      ...messages
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'run_python',
        description: '在浏览器沙盒中执行 JavaScript 代码',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        }
      }
    }],
    stream: true
  };

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
    return res.status(500).json({ error: errText });
  }

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
      if (raw === '[DONE]') continue;
      try {
        const chunk = JSON.parse(raw);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: delta.content })}\n\n`);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) currentToolCall.name = tc.function.name;
            if (tc.function?.arguments) currentToolCall.argsStr += tc.function.arguments;
          }
        }
      } catch (e) {}
    }
  }

  if (currentToolCall.name) {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(currentToolCall.argsStr || '{}');
    } catch (e) {}
    res.write(`data: ${JSON.stringify({
      type: 'tool-call',
      toolName: currentToolCall.name,
      args: parsedArgs
    })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}