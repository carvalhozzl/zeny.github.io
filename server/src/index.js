/**
 * Servidor do Zeny (Cloudflare Worker).
 *
 * Guarda a chave da API do Claude como segredo e expõe só um endpoint
 * específico do Zeny (POST /chat). O prompt, o modelo e o limite de tokens
 * ficam aqui, então o app não consegue usar a chave para outra coisa.
 *
 * Também cuida das assinaturas pela Stripe: cria o pagamento, recebe a
 * confirmação (webhook), guarda o plano de cada pessoa e só libera a IA para
 * quem tem assinatura ativa (quando a Stripe está configurada).
 *
 * Variáveis:
 *   ANTHROPIC_API_KEY      (segredo)  chave da API do Claude
 *   STRIPE_SECRET_KEY      (segredo)  chave secreta da Stripe (sk_live_... ou sk_test_...)
 *   STRIPE_WEBHOOK_SECRET  (segredo)  segredo do webhook da Stripe (whsec_...)
 *   ALLOWED_ORIGINS        (var)      origens permitidas, separadas por vírgula
 *   MODEL                  (var)      modelo do Claude (padrão: claude-sonnet-5)
 *   RATE_LIMIT             (var)      mensagens por minuto por IP (padrão: 20)
 *   PLANS                  (var)      preços (em centavos) e limites de IA de cada plano, em JSON
 */

const SYSTEM_PROMPT = `Você é o Zeny, um assistente pessoal brasileiro, simpático e objetivo, que organiza finanças (pessoais e da empresa), hábitos e tarefas do usuário a partir de mensagens de texto ou voz transcrita.

Responda SEMPRE e SOMENTE com um objeto JSON válido, sem markdown, no formato:
{"reply": "texto curto em português para o usuário", "actions": [ ... ]}

Ações disponíveis (use quantas forem necessárias, ou nenhuma):
- {"type":"add_transaction","kind":"in"|"out","amount":number,"description":string,"category":string,"scope":"pessoal"|"empresa","date":"YYYY-MM-DD"}
  Categorias: Alimentação, Transporte, Moradia, Saúde, Lazer, Educação, Compras, Assinaturas, Contas, Salário, Vendas, Outros, Outras receitas.
- {"type":"add_task","title":string,"priority":"alta"|"media"|"baixa","due":"YYYY-MM-DD" ou "","time":"HH:MM" ou ""}
- {"type":"complete_task","title":string}   (use o título exato de uma tarefa pendente)
- {"type":"add_habit","name":string}
- {"type":"check_habit","name":string,"date":"YYYY-MM-DD"}   (use o nome exato de um hábito existente)
- {"type":"add_goal","name":string,"target":number}
- {"type":"add_to_goal","name":string,"amount":number}
- {"type":"add_subscription","name":string,"amount":number,"day":number}
- {"type":"set_budget","amount":number}   (orçamento de gastos do mês)
- {"type":"add_wish","name":string,"price":number,"saved":number opcional,"link":string opcional}   (algo que a pessoa quer comprar)
- {"type":"add_to_wish","name":string,"amount":number}   (dinheiro guardado para um desejo de compra; negativo para retirar)
- {"type":"buy_wish","name":string,"price_paid":number opcional,"register_expense":true|false}   (a pessoa comprou um item da lista)

Regras:
- Uma mensagem pode conter várias informações (ex.: "gastei 30 no uber e 50 no mercado" = 2 transações).
- Classifique cada valor separadamente: "recebi/ganhei/salário" = kind "in"; "gastei/paguei/comprei" = kind "out". Ex.: "recebi 4000, gastei 3700 na fatura" = 1 entrada e 1 gasto.
- Se a pessoa perguntar quanto sobra ou como fica o mês, some os lançamentos novos aos do contexto e responda o saldo.
- Calcule datas relativas (amanhã, sexta, dia 15) a partir da data de hoje do contexto.
- "Quero comprar X de R$ Y" é um desejo de compra (add_wish). Metas sem um item específico (reserva, viagem) usam add_goal.
- "Guardei 200 para X": use add_to_wish se X estiver em desejos_de_compra, senão add_to_goal.
- Quando um desejo ou meta atinge o valor, o app avisa a pessoa sozinho. Você não precisa avisar.
- Para perguntas (quanto gastei, o que tenho pra fazer, quanto falta para comprar algo, dicas), responda usando os dados do contexto, sem ações.
- Se faltar informação essencial (ex.: valor), pergunte na "reply" e não crie a ação.
- Respostas curtas e calorosas. Use R$ no formato brasileiro. Pode usar **negrito** e listas com "• ".
- Siga o campo "personalidade" do contexto.
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

// ---------- Planos e assinaturas ----------
// Os preços valem daqui (o app só mostra); ninguém consegue pagar menos mexendo no app.
const DEFAULT_PLANS = {
  basico: { name: 'Básico', monthly: 1400, annual: null, aiMessages: 30 },
  medio: { name: 'Médio', monthly: 2700, annual: null, aiMessages: 300 },
  premium: { name: 'Premium', monthly: 9000, annual: null, aiMessages: null },
};
function plans(env) {
  try { return env.PLANS ? JSON.parse(env.PLANS) : DEFAULT_PLANS; } catch (e) { return DEFAULT_PLANS; }
}
const billingOn = (env) => !!(env.STRIPE_SECRET_KEY && env.ACCOUNTS);
const validClient = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const ACTIVE = ['active', 'trialing', 'past_due'];

// Cada pessoa (código do app) tem um Durable Object com a assinatura e o uso do mês.
function account(env, clientId) {
  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(clientId));
  const call = async (op, key, value) => (await stub.fetch('https://account/', { method: 'POST', body: JSON.stringify({ op, key, value }) })).json();
  return { get: (k) => call('get', k), put: (k, v) => call('put', k, v), incr: (k) => call('incr', k) };
}

export class Accounts {
  constructor(state) { this.storage = state.storage; }
  async fetch(request) {
    const { op, key, value } = await request.json();
    if (op === 'get') return Response.json((await this.storage.get(key)) ?? null);
    if (op === 'put') { await this.storage.put(key, value); return Response.json(true); }
    if (op === 'incr') { const n = ((await this.storage.get(key)) || 0) + 1; await this.storage.put(key, n); return Response.json(n); }
    return Response.json(null, { status: 400 });
  }
}

// Chamada à API da Stripe (formulário no formato a[b][c]=valor).
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, path, params, method = 'POST') {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? form(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ? data.error.message : 'Stripe ' + res.status);
  return data;
}

// Confere a assinatura do webhook (cabeçalho Stripe-Signature: t=...,v1=...).
async function verifyStripe(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((x) => x.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && [...s].every((c, i) => c === hex[i]));
}

function subFromStripe(obj, meta) {
  const item = obj.items && obj.items.data && obj.items.data[0];
  const end = obj.current_period_end || (item && item.current_period_end) || null;
  return {
    plan: meta.plan, billing: meta.billing || 'monthly', status: obj.status,
    customer: obj.customer, subscription: obj.id,
    renewsAt: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!obj.cancel_at_period_end,
  };
}

function allowedReturn(env, returnUrl) {
  try {
    const u = new URL(returnUrl);
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim());
    return allowed.includes(u.origin) ? u.origin + u.pathname : null;
  } catch (e) { return null; }
}

async function handleBilling(request, env, url, cors) {
  const P = plans(env);

  // Webhook da Stripe: sem CORS, conferido pela assinatura.
  if (url.pathname === '/stripe/webhook' && request.method === 'POST') {
    const raw = await request.text();
    if (!(await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return new Response('assinatura inválida', { status: 400 });
    const event = JSON.parse(raw);
    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && obj && obj.mode === 'subscription') {
      const clientId = obj.client_reference_id;
      if (validClient(clientId) && obj.subscription) {
        const sub = await stripe(env, 'subscriptions/' + obj.subscription, null, 'GET');
        await account(env, clientId).put('sub', subFromStripe(sub, sub.metadata || obj.metadata || {}));
      }
    } else if (['customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.created'].includes(event.type) && obj) {
      const meta = obj.metadata || {};
      if (validClient(meta.clientId)) await account(env, meta.clientId).put('sub', subFromStripe(obj, meta));
    }
    return new Response('ok');
  }

  if (!cors._ok) return json({ error: 'Origem não permitida' }, 403, cors);

  if (url.pathname === '/plan' && request.method === 'GET') {
    const clientId = url.searchParams.get('client');
    const catalog = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, { name: v.name, monthly: v.monthly, annual: v.annual, aiMessages: v.aiMessages }]));
    if (!billingOn(env)) return json({ billing: false, plans: catalog }, 200, cors);
    if (!validClient(clientId)) return json({ error: 'Código inválido' }, 400, cors);
    const acc = account(env, clientId);
    const sub = await acc.get('sub');
    const active = sub && ACTIVE.includes(sub.status) && P[sub.plan];
    const used = (await acc.get('usage:' + new Date().toISOString().slice(0, 7))) || 0;
    return json({
      billing: true, plans: catalog,
      plan: active ? sub.plan : null, status: sub ? sub.status : null,
      renewsAt: sub ? sub.renewsAt : null, cancelAtPeriodEnd: sub ? sub.cancelAtPeriodEnd : false,
      aiUsed: used, aiLimit: active ? P[sub.plan].aiMessages : 0,
    }, 200, cors);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido' }, 400, cors); }
  if (!billingOn(env)) return json({ error: 'Pagamentos ainda não configurados' }, 503, cors);
  if (!validClient(body.clientId)) return json({ error: 'Código inválido' }, 400, cors);

  if (url.pathname === '/checkout' && request.method === 'POST') {
    const plan = P[body.plan];
    const billing = body.billing === 'annual' ? 'annual' : 'monthly';
    const amount = plan && plan[billing];
    const back = allowedReturn(env, body.returnUrl);
    if (!plan || !amount) return json({ error: 'Plano indisponível' }, 400, cors);
    if (!back) return json({ error: 'Endereço de retorno não permitido' }, 400, cors);
    const meta = { clientId: body.clientId, plan: body.plan, billing };
    const session = await stripe(env, 'checkout/sessions', {
      mode: 'subscription',
      client_reference_id: body.clientId,
      success_url: back + '?pago=1',
      cancel_url: back + '?pago=0',
      locale: 'pt-BR',
      allow_promotion_codes: 'true',
      metadata: meta,
      subscription_data: { metadata: meta },
      line_items: { 0: { quantity: 1, price_data: { currency: 'brl', unit_amount: amount, recurring: { interval: billing === 'annual' ? 'year' : 'month' }, product_data: { name: `Zeny ${plan.name}` } } } },
    });
    return json({ url: session.url }, 200, cors);
  }

  if (url.pathname === '/portal' && request.method === 'POST') {
    const sub = await account(env, body.clientId).get('sub');
    const back = allowedReturn(env, body.returnUrl);
    if (!sub || !sub.customer) return json({ error: 'Nenhuma assinatura encontrada' }, 404, cors);
    const portal = await stripe(env, 'billing_portal/sessions', { customer: sub.customer, return_url: back || undefined, locale: 'pt-BR' });
    return json({ url: portal.url }, 200, cors);
  }

  return json({ error: 'Não encontrado' }, 404, cors);
}

// Com a Stripe configurada, a IA exige assinatura ativa e respeita o limite do plano.
async function checkAiQuota(env, clientId) {
  if (!billingOn(env)) return null;
  if (!validClient(clientId)) return { status: 402, code: 'no_plan', error: 'Assine um plano para conversar com a IA.' };
  const acc = account(env, clientId);
  const sub = await acc.get('sub');
  const P = plans(env);
  if (!sub || !ACTIVE.includes(sub.status) || !P[sub.plan]) return { status: 402, code: 'no_plan', error: 'Assine um plano para conversar com a IA.' };
  const limit = P[sub.plan].aiMessages;
  const key = 'usage:' + new Date().toISOString().slice(0, 7);
  if (limit != null && ((await acc.get(key)) || 0) >= limit) return { status: 429, code: 'quota', error: `Você usou as ${limit} mensagens com a IA do plano ${P[sub.plan].name} este mês.` };
  return { acc, key };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: (({ _ok, ...h }) => h)(cors) });
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, billing: billingOn(env) }, 200, cors);
    if (['/plan', '/checkout', '/portal', '/stripe/webhook'].includes(url.pathname)) {
      try { return await handleBilling(request, env, url, cors); } catch (e) {
        console.error('billing', e);
        return json({ error: 'Não foi possível falar com a Stripe agora.' }, 502, cors);
      }
    }
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

    const quota = await checkAiQuota(env, body.clientId);
    if (quota && quota.error) return json({ error: quota.error, code: quota.code }, quota.status, cors);

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
    if (quota && quota.acc) await quota.acc.incr(quota.key);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return json(parseReply(text), 200, cors);
  },
};
