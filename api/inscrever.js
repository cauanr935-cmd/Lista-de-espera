// Função serverless do Vercel: recebe nome + WhatsApp e repassa ao Google Sheets.
// A URL do Apps Script vem da variável de ambiente SHEETS_URL (configurada no painel do Vercel).
const JANELA_MS = 10 * 60 * 1000, MAX_POR_JANELA = 5; // limite simples por IP (vale por instância)
const tentativas = new Map();

function limitado(ip) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter(t => agora - t < JANELA_MS);
  lista.push(agora);
  tentativas.set(ip, lista);
  return lista.length > MAX_POR_JANELA;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ erro: 'Método não permitido.' }); }
  if (!process.env.SHEETS_URL) { console.error('SHEETS_URL não configurada'); return res.status(500).json({ erro: 'Não deu pra salvar agora.' }); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
  if (limitado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Tenta de novo daqui a pouco.' });

  try {
    const d = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const nome = String(d.nome ?? '').trim().replace(/\s+/g, ' ');
    let whatsapp = String(d.whatsapp ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (whatsapp.length > 11 && whatsapp.startsWith('55')) whatsapp = whatsapp.slice(2); // remove DDI do Brasil
    if (nome.length < 2 || nome.length > 80) return res.status(400).json({ erro: 'Nome inválido.' });
    if (whatsapp.length < 10 || whatsapp.length > 11) return res.status(400).json({ erro: 'WhatsApp inválido.' });
    const seguro = s => /^[=+\-@]/.test(s) ? "'" + s : s; // evita fórmula na planilha
    const r = await fetch(process.env.SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ nome: seguro(nome), whatsapp }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('sheets ' + r.status);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('erro ao salvar:', e.message);
    return res.status(502).json({ erro: 'Não deu pra salvar agora.' });
  }
};
