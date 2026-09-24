/**
 * Servidor do Zeny (Cloudflare Worker).
 *
 * Guarda a chave da API do Claude como segredo e expõe só um endpoint
 * específico do Zeny (POST /chat). O prompt, o modelo e o limite de tokens
 * ficam aqui, então o app não consegue usar a chave para outra coisa.
 *
 * Variáveis:
 *   ANTHROPIC_API_KEY  (segredo)  chave da API do Claude
 *   ALLOWED_ORIGINS    (var)      origens permitidas, separadas por vírgula
 *   MODEL              (var)      modelo do Claude (padrão: claude-sonnet-5)
 *   RATE_LIMIT         (var)      mensagens por minuto por IP (padrão: 20)
 */

const SYSTEM_PROMPT = `Você é o Zeny, um assistente pessoal brasileiro, simpático e objetivo, que organiza finanças (pessoais e da empresa), hábitos e tarefas do usuário a partir de mensagens de texto ou voz transcrita.

Responda SEMPRE e SOMENTE com um objeto JSON válido, sem markdown, no formato:
{"reply": "texto curto em português para o usuário", "actions": [ ... ]}

Ações disponíveis (use quantas forem necessárias, ou nenhuma):
- {"type":"add_transaction","kind":"in"|"out","amount":number,"description":string,"category":string,"scope":"pessoal"|"empresa","date":"YYYY-MM-DD"}
  Categorias sugeridas: Alimentação, Transporte, Moradia, Saúde, Lazer, Educação, Compras, Assinaturas, Contas, Salário, Vendas, Outros, Outras receitas.
- {"type":"add_task","title":string,"priority":"alta"|"media"|"baixa","due":"YYYY-MM-DD" ou "","time":"HH:MM" ou ""}
- {"type":"complete_task","title":string}   (use o título exato de uma tarefa pendente)
- {"type":"add_habit","name":string}
- {"type":"check_habit","name":string,"date":"YYYY-MM-DD"}   (use o nome exato de um hábito existente)
- {"type":"add_goal","name":string,"target":number}
- {"type":"add_to_goal","name":string,"amount":number}
- {"type":"add_subscription","name":string,"amount":number,"day":number}

Regras:
- Uma mensagem pode conter várias informações (ex.: "gastei 30 no uber e 50 no mercado" = 2 transações).
- Calcule datas relativas (amanhã, sexta, dia 15) a partir da data de hoje do contexto.
- Para perguntas (quanto gastei, o que tenho pra fazer, dicas), responda usando os dados do contexto, sem ações.
- Se faltar informação essencial (ex.: valor), pergunte na "reply" e não crie a ação.
- Respostas curtas, calorosas, podem ter 1 emoji. Use R$ no formato brasileiro.
- Você só ajuda com finanças pessoais, hábitos, tarefas e organização do dia a dia.`;

const MAX_MESSAGE = 2000;
const MAX_CONTEXT = 20000;
const MAX_HISTORY = 12;

// Limite simples por IP. É por instância do Worker, então é aproximado;
// para algo rígido, use a regra de Rate Limiting do Cloudflare.
const hits = new Map();
function rateLimited(ip, limit) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    _ok: ok,
  };
}

function json(body, status, cors) {
  const { _ok, ...headers } = cors;
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}

function buildMessages(history, message, context) {
  const msgs = [];
  for (const m of history.slice(-MAX_HISTORY)) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const text = String(m.text || '').slice(0, MAX_MESSAGE);
    if (!text) continue;
    if (!msgs.length && role !== 'user') continue; // a conversa precisa começar pelo usuário
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + text;
    else msgs.push({ role, content: text });
  }
  const content = `Contexto atual (JSON):\n${context}\n\nMensagem do usuário:\n${message}`;
  if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs[msgs.length - 1].content += '\n' + content;
  else msgs.push({ role: 'user', content });
  return msgs;
}

function parseReply(text) {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const parsed = JSON.parse(text.slice(i, j + 1));
      return { reply: String(parsed.reply || ''), actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
    } catch (e) { /* cai no texto puro */ }
  }
  return { reply: text.trim(), actions: [] };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: (({ _ok, ...h }) => h)(cors) });
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (request.method !== 'POST' || url.pathname !== '/chat') return json({ error: 'Não encontrado' }, 404, cors);
    if (!cors._ok) return json({ error: 'Origem não permitida' }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Servidor sem chave configurada' }, 500, cors);

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (rateLimited(ip, Number(env.RATE_LIMIT) || 20)) return json({ error: 'Muitas mensagens. Aguarde um minuto.' }, 429, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido' }, 400, cors); }
    const message = String(body.message || '').trim().slice(0, MAX_MESSAGE);
    const context = String(body.context || '{}').slice(0, MAX_CONTEXT);
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return json({ error: 'Mensagem vazia' }, 400, cors);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: buildMessages(history, message, context),
      }),
    });
    if (!res.ok) {
      console.error('Anthropic', res.status, await res.text());
      return json({ error: 'IA indisponível no momento' }, 502, cors);
    }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return json(parseReply(text), 200, cors);
  },
};
