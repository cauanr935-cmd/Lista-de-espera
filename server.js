// Servidor mínimo, sem dependências. Rode com: node --env-file=.env server.js
// Serve o index.html e recebe os cadastros em /api/inscrever, repassando ao Google Sheets.
// A URL do Apps Script fica só aqui no servidor (via .env) e nunca vai para o navegador.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { SHEETS_URL, PORT = 3000 } = process.env;
if (!SHEETS_URL) { console.error('Faltou SHEETS_URL no .env'); process.exit(1); }

const PAGINA = path.join(__dirname, 'index.html'); // única coisa servida: nada de .env ou server.js
const LIMITE_CORPO = 2 * 1024;                      // 2 KB bastam para nome + WhatsApp
const JANELA_MS = 10 * 60 * 1000, MAX_POR_JANELA = 5; // 5 cadastros por IP a cada 10 min
const tentativas = new Map();

function limitado(ip) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter(t => agora - t < JANELA_MS);
  lista.push(agora);
  tentativas.set(ip, lista);
  return lista.length > MAX_POR_JANELA;
}
setInterval(() => { const a = Date.now(); for (const [ip, l] of tentativas) if (l.every(t => a - t >= JANELA_MS)) tentativas.delete(ip); }, JANELA_MS).unref();

function responde(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': tipo,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', c => { tam += c.length; if (tam > LIMITE_CORPO) { falha(new Error('grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(PAGINA, (err, html) => err ? responde(res, 500, { erro: 'indisponível' }) : responde(res, 200, html, 'text/html; charset=utf-8'));
  }

  if (req.method === 'POST' && url.pathname === '/api/inscrever') {
    const ip = req.socket.remoteAddress || '?';
    if (limitado(ip)) return responde(res, 429, { erro: 'Muitas tentativas. Tenta de novo daqui a pouco.' });
    try {
      const d = JSON.parse(await lerCorpo(req));
      const nome = String(d.nome ?? '').trim().replace(/\s+/g, ' ');
      const whatsapp = String(d.whatsapp ?? '').replace(/\D/g, '');
      if (nome.length < 2 || nome.length > 80) return responde(res, 400, { erro: 'Nome inválido.' });
      if (whatsapp.length < 10 || whatsapp.length > 11) return responde(res, 400, { erro: 'WhatsApp inválido.' });
      // evita "fórmula" colada na planilha (=, +, -, @ no começo do texto)
      const seguro = s => /^[=+\-@]/.test(s) ? "'" + s : s;
      const r = await fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ nome: seguro(nome), whatsapp }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('sheets ' + r.status);
      return responde(res, 200, { ok: true });
    } catch (e) {
      console.error('erro ao salvar:', e.message);
      return responde(res, 502, { erro: 'Não deu pra salvar agora.' });
    }
  }

  responde(res, 404, { erro: 'não encontrado' });
}).listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
