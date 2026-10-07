export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { originalQuestion, toolName, toolArgs, toolResult } = req.body;

  const messages = [
    { role: 'user', content: originalQuestion },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: toolName, arguments: JSON.stringify(toolArgs) }
      }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: toolResult }
  ];

  const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({ model: 'deepseek-chat', messages, stream: true })
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

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
}