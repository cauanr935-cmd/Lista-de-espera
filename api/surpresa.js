// Só entrega o endereço do vídeo depois da meia-noite de sábado (horário de Brasília, UTC-3, sem horário de verão).
// A checagem é feita aqui, no servidor: mexer no relógio do computador ou no código da página não adianta.
const ABRE = Date.parse(process.env.SURPRESA_ABRE_EM || '2026-11-07T00:00:00-03:00');
const VIDEO = '/s/88d1eb92d6ca5345e5df8857.mp4';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (Date.now() < ABRE) { res.statusCode = 403; return res.end('{"aberto":false}'); }
  res.end(JSON.stringify({ aberto: true, url: VIDEO }));
};
