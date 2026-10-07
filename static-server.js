const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  const ext = path.extname(file);
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css'
  }[ext] || 'text/plain';

  // ⚠️ 关键：WebContainer 需要的两个安全头
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}).listen(8080, () => {
  console.log('Static server on http://localhost:8080 (with COOP/COEP)');
});