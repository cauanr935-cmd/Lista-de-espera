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
      let whatsapp = String(d.whatsapp ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (whatsapp.length > 11 && whatsapp.startsWith('55')) whatsapp = whatsapp.slice(2); // remove DDI do Brasil
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

  if (req.method === 'GET' && url.pathname === '/api/surpresa') return require('./api/surpresa.js')(req, res);

  // vídeos em /s/<nome>.mp4 (com Range, para o player poder avançar/voltar)
  const m = url.pathname.match(/^\/s\/([a-f0-9]{24})\.mp4$/);
  if (req.method === 'GET' && m) {
    const arq = path.join(__dirname, 's', m[1] + '.mp4');
    return fs.stat(arq, (err, st) => {
      if (err) return responde(res, 404, { erro: 'não encontrado' });
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      let ini = 0, fim = st.size - 1, status = 200;
      if (r && (r[1] || r[2])) { status = 206; if (r[1]) { ini = +r[1]; if (r[2]) fim = Math.min(+r[2], fim); } else ini = Math.max(0, st.size - +r[2]); }
      if (ini > fim) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': fim - ini + 1 };
      if (status === 206) h['Content-Range'] = `bytes ${ini}-${fim}/${st.size}`;
      res.writeHead(status, h);
      fs.createReadStream(arq, { start: ini, end: fim }).pipe(res);
    });
  }

  responde(res, 404, { erro: 'não encontrado' });
}).listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
