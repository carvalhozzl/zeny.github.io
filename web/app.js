/* Zeny — assistente pessoal com IA.
 * Finanças, hábitos e tarefas organizados por conversa (texto ou voz).
 *
 * IA, em ordem de preferência:
 *   1. Claude pelo claude.ai, quando a página roda como Artifact (capacidade "sample");
 *   2. servidor próprio (server/), que guarda a chave da API;
 *   3. interpretador local em português, que funciona sem internet.
 * Os dados ficam no localStorage do aparelho.
 */
(() => {
  'use strict';

  const VERSION = '2.0.0';
  const CFG = window.ZENY_CONFIG || {};
  const STORE_KEY = 'zeny:v1';

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Maiúscula inicial, sem estragar nomes como "iPhone" ou "eBay".
  const cap = (s) => (s && !/^[a-z][A-Z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const pad = (n) => String(n).padStart(2, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sum = (list) => list.reduce((s, t) => s + t.amount, 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (v) => moneyFmt.format(Number(v) || 0);
  const compact = (v) => compactFmt.format(Number(v) || 0);
  const moneyShort = (v) => (Math.abs(v) >= 10000 ? 'R$ ' + compact(v) : money(v));

  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long' });
  const shortMonth = (d) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const longDate = (d) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (s) => {
    if (!s) return '';
    if (s === today()) return 'hoje';
    if (s === ymd(addDays(new Date(), 1))) return 'amanhã';
    if (s === ymd(addDays(new Date(), -1))) return 'ontem';
    return parseYmd(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  };
  const dayLabel = (s) => {
    const f = fmtDate(s);
    if (f === 'hoje' || f === 'ontem' || f === 'amanhã') return cap(f);
    return cap(parseYmd(s).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''));
  };
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

  const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  // ---------- Categorias ----------
  const CATS = {
    'Alimentação': { icon: 'food', color: '#E07A3F', words: ['mercado', 'supermercado', 'restaurante', 'lanche', 'ifood', 'comida', 'padaria', 'almoco', 'jantar', 'cafe', 'pizza', 'acougue', 'feira', 'hamburguer', 'sorvete'] },
    'Transporte': { icon: 'car', color: '#3B82C4', words: ['uber', 'gasolina', 'combustivel', 'onibus', 'estacionamento', 'pedagio', 'taxi', 'metro', 'carro', 'mecanico', 'passagem'] },
    'Moradia': { icon: 'home', color: '#7A68C9', words: ['aluguel', 'luz', 'energia', 'agua', 'condominio', 'internet', 'gas', 'iptu', 'reforma', 'movel'] },
    'Saúde': { icon: 'heart', color: '#D2495E', words: ['farmacia', 'remedio', 'medico', 'academia', 'dentista', 'consulta', 'exame', 'plano de saude', 'hospital'] },
    'Lazer': { icon: 'smile', color: '#C79A12', words: ['cinema', 'bar', 'show', 'viagem', 'festa', 'jogo', 'passeio', 'cerveja', 'balada'] },
    'Educação': { icon: 'book', color: '#2E9E8F', words: ['curso', 'escola', 'faculdade', 'livro', 'material escolar'] },
    'Compras': { icon: 'bag', color: '#C2569B', words: ['roupa', 'loja', 'shopping', 'presente', 'amazon', 'mercado livre', 'shopee', 'tenis', 'celular'] },
    'Assinaturas': { icon: 'repeat', color: '#5B7FA6', words: ['netflix', 'spotify', 'prime', 'disney', 'youtube', 'assinatura', 'hbo', 'globoplay', 'icloud'] },
    'Contas': { icon: 'receipt', color: '#8A7B6B', words: ['cartao', 'fatura', 'boleto', 'emprestimo', 'juros', 'imposto', 'taxa'] },
    'Salário': { icon: 'briefcase', color: '#16895A', words: ['salario', 'holerite'] },
    'Vendas': { icon: 'up', color: '#2F9E6E', words: ['venda', 'vendi', 'cliente', 'servico', 'freela', 'freelance', 'faturei', 'projeto'] },
    'Outros': { icon: 'dots', color: '#7B8784', words: [] },
    'Outras receitas': { icon: 'in', color: '#4E9F82', words: [] },
  };
  const CAT_NAMES = Object.keys(CATS);
  const catMeta = (c) => CATS[c] || CATS[CAT_NAMES.find((k) => norm(k) === norm(c))] || CATS.Outros;
  const catIcon = (c) => { const m = catMeta(c); return `<span class="cat-ic" style="background:${m.color}24;color:${m.color}">${ic(m.icon)}</span>`; };
  function guessCat(text, type) {
    const t = norm(text);
    for (const [cat, meta] of Object.entries(CATS)) {
      if (meta.words.some((w) => new RegExp(`\\b${w}`).test(t))) return cat;
    }
    return type === 'in' ? 'Outras receitas' : 'Outros';
  }
  const guessScope = (text) => (/\b(empresa|negocio|cnpj|mei|firma)\b/.test(norm(text)) ? 'empresa' : 'pessoal');

  // ---------- Planos ----------
  const DEFAULT_PLANS = [
    { id: 'basico', name: 'Básico', monthly: null, annual: null, limits: {}, features: [] },
  ];
  const PLAN_CFG = CFG.plans || {};
  const PLANS = Array.isArray(PLAN_CFG.list) && PLAN_CFG.list.length ? PLAN_CFG.list : DEFAULT_PLANS;
  const ENFORCE = !!PLAN_CFG.enforce;
  const currentPlan = () => PLANS.find((p) => p.id === S.settings.plan) || PLANS[0];
  const limitOf = (key) => (currentPlan().limits || {})[key];
  const allowed = (key) => !ENFORCE || limitOf(key) !== false;
  const underLimit = (key, count) => { if (!ENFORCE) return true; const v = limitOf(key); return v == null || count < v; };
  const planWith = (key) => PLANS.find((p) => { const v = (p.limits || {})[key]; return v === true || v == null; });
  function gate(text) { toast(text, { label: 'Ver planos', fn: () => go('plans') }); }

  // ---------- Estado ----------
  const defaultSettings = () => ({
    serverUrl: '', speak: false, userName: '', theme: 'system', budget: 0,
    persona: 'padrao', voiceStyle: 'padrao', voiceURI: '',
    onboarded: false, plan: PLANS[0].id, billing: 'annual', lastView: 'home',
  });
  const defaults = () => ({ v: 2, tx: [], goals: [], wishes: [], subs: [], habits: [], tasks: [], chat: [], demo: false, usage: { month: '', ai: 0 }, settings: defaultSettings() });

  function initialLastPosted(day) {
    const now = new Date();
    return now.getDate() >= Math.min(day, daysInMonth(now.getFullYear(), now.getMonth()))
      ? monthKey(now)
      : monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }

  function migrate(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const s = defaults();
    for (const k of ['tx', 'goals', 'wishes', 'subs', 'habits', 'tasks', 'chat']) s[k] = Array.isArray(d[k]) ? d[k] : [];
    s.demo = !!d.demo;
    s.usage = d.usage && typeof d.usage === 'object' ? { month: String(d.usage.month || ''), ai: Number(d.usage.ai) || 0 } : s.usage;
    s.settings = Object.assign(defaultSettings(), d.settings || {});
    if (!d.v && (s.tx.length || s.chat.length || s.tasks.length || s.habits.length)) s.settings.onboarded = true;

    s.tx = s.tx.filter((t) => t && Number.isFinite(Number(t.amount)) && isYmd(t.date)).map((t) => ({
      id: t.id || uid(), type: t.type === 'in' ? 'in' : 'out', amount: Math.abs(Number(t.amount)),
      desc: String(t.desc || 'Lançamento'), cat: t.cat || 'Outros', scope: t.scope === 'empresa' ? 'empresa' : 'pessoal',
      date: t.date, auto: !!t.auto, subId: t.subId || null,
    }));
    s.goals = s.goals.filter((g) => g && g.name).map((g) => {
      const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
      return { id: g.id || uid(), name: String(g.name), target, saved, notified: g.notified ?? (target > 0 && saved >= target), reachedAt: g.reachedAt || null };
    });
    s.wishes = s.wishes.filter((w) => w && w.name).map((w) => {
      const price = Math.abs(Number(w.price)) || 0, saved = Math.max(0, Number(w.saved) || 0);
      return {
        id: w.id || uid(), name: String(w.name), price, saved, link: /^https?:\/\//.test(w.link || '') ? w.link : '',
        created: isYmd(w.created) ? w.created : today(), reachedAt: w.reachedAt || null,
        notified: w.notified ?? (price > 0 && saved >= price), bought: !!w.bought, boughtAt: w.boughtAt || null, paid: Number(w.paid) || 0,
        deposits: Array.isArray(w.deposits) ? w.deposits.filter((x) => x && isYmd(x.date) && Number.isFinite(Number(x.amount))).map((x) => ({ date: x.date, amount: Number(x.amount) })) : [],
      };
    });
    s.subs = s.subs.filter((x) => x && x.name).map((x) => {
      const day = Math.min(31, Math.max(1, Number(x.day) || 1));
      return {
        id: x.id || uid(), name: String(x.name), amount: Number(x.amount) || 0, day,
        cat: x.cat || 'Assinaturas', scope: x.scope === 'empresa' ? 'empresa' : 'pessoal',
        autoPost: x.autoPost !== false, lastPosted: x.lastPosted || initialLastPosted(day),
      };
    });
    s.habits = s.habits.filter((h) => h && h.name).map((h) => ({ id: h.id || uid(), name: String(h.name), days: h.days && typeof h.days === 'object' ? h.days : {}, created: h.created || today() }));
    s.tasks = s.tasks.filter((t) => t && t.title).map((t) => ({
      id: t.id || uid(), title: String(t.title), prio: ['alta', 'media', 'baixa'].includes(t.prio) ? t.prio : 'media',
      due: isYmd(t.due) ? t.due : '', time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '', done: !!t.done, doneAt: t.doneAt || null,
    }));
    s.chat = s.chat.filter((m) => m && typeof m.text === 'string').slice(-200).map((m) => ({
      id: m.id || uid(), role: m.role === 'user' ? 'user' : 'bot', text: m.text, at: m.at || Date.now(),
      chips: Array.isArray(m.chips) ? m.chips.map((c) => (typeof c === 'string' ? { icon: 'check', label: c } : c)) : [],
      undoId: m.undoId || null, undone: !!m.undone,
    }));
    s.v = 2;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { /* armazenamento indisponível ou corrompido */ }
    return defaults();
  }
  let saveWarned = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {
      if (!saveWarned) { saveWarned = true; toast('Não consegui salvar neste navegador. Seus dados valem só até fechar a página.'); }
    }
  }

  let S = load();

  // ---------- Alterações com "desfazer" ----------
  const undoStack = [];
  const snapshot = () => JSON.stringify({ tx: S.tx, goals: S.goals, wishes: S.wishes, subs: S.subs, habits: S.habits, tasks: S.tasks, budget: S.settings.budget });
  function commit(fn) {
    const snap = snapshot();
    const result = fn();
    const reached = detectReached();
    const id = uid();
    undoStack.push({ id, snap });
    if (undoStack.length > 40) undoStack.shift();
    save();
    renderAll();
    if (reached.length) { pendingCelebrations.push(...reached); setTimeout(flushCelebrations, 450); }
    return { id, result };
  }

  // Metas de compra e de economia: marca as que acabaram de atingir o valor.
  const pendingCelebrations = [];
  function detectReached() {
    const out = [];
    for (const w of S.wishes) {
      if (w.bought) continue;
      if (w.price > 0 && w.saved >= w.price) {
        if (!w.notified) { w.notified = true; w.reachedAt = today(); out.push({ kind: 'wish', id: w.id }); }
      } else if (w.notified) { w.notified = false; w.reachedAt = null; }
    }
    for (const g of S.goals) {
      if (g.target > 0 && g.saved >= g.target) {
        if (!g.notified) { g.notified = true; g.reachedAt = today(); out.push({ kind: 'goal', id: g.id }); }
      } else if (g.notified) { g.notified = false; g.reachedAt = null; }
    }
    return out;
  }
  function undo(id) {
    const top = undoStack[undoStack.length - 1];
    if (!top || (id && top.id !== id)) { toast('Só dá para desfazer a última alteração.'); return false; }
    undoStack.pop();
    const snap = JSON.parse(top.snap);
    Object.assign(S, { tx: snap.tx, goals: snap.goals, wishes: snap.wishes || [], subs: snap.subs, habits: snap.habits, tasks: snap.tasks });
    S.settings.budget = snap.budget;
    S.chat.forEach((m) => { if (m.undoId === top.id) m.undone = true; });
    save(); renderAll(); renderChat();
    toast('Alteração desfeita');
    return true;
  }
  const undoToast = (msg, id) => toast(msg, { label: 'Desfazer', fn: () => undo(id) });

  // ---------- Consultas ----------
  function monthTx(y, m, scope = 'all') {
    const key = `${y}-${pad(m + 1)}`;
    return S.tx.filter((t) => t.date.startsWith(key) && (scope === 'all' || t.scope === scope));
  }
  function totals(list) {
    const inc = sum(list.filter((t) => t.type === 'in'));
    const out = sum(list.filter((t) => t.type === 'out'));
    return { inc, out, bal: inc - out };
  }
  function byCat(list) {
    const m = {};
    list.filter((t) => t.type === 'out').forEach((t) => { m[t.cat] = (m[t.cat] || 0) + t.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }
  function streak(h) {
    let n = 0, d = new Date();
    if (!h.days[ymd(d)]) d = addDays(d, -1);
    while (h.days[ymd(d)]) { n++; d = addDays(d, -1); }
    return n;
  }
  function bestStreak(h) {
    const keys = Object.keys(h.days).filter((k) => h.days[k]).sort();
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      run = prev && ymd(addDays(parseYmd(prev), 1)) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }
  function daysUntil(day) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const thisMonth = Math.min(day, daysInMonth(y, m));
    if (thisMonth >= now.getDate()) return thisMonth - now.getDate();
    const next = new Date(y, m + 1, Math.min(day, daysInMonth(y, m + 1)));
    return Math.round((next - parseYmd(today())) / 86400000);
  }
  const PRIO_ORDER = { alta: 0, media: 1, baixa: 2 };
  function sortTasks(a, b) {
    return (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio];
  }
  function findByName(list, name, key = 'name') {
    const n = norm(name).trim();
    if (!n) return null;
    let best = null, bestScore = 0;
    const words = n.split(/\s+/).filter((w) => w.length > 2);
    for (const it of list) {
      const v = norm(it[key]);
      if (v === n) return it;
      let score = v.includes(n) || n.includes(v) ? 5 : 0;
      score += words.filter((w) => v.includes(w)).length;
      if (score > bestScore) { best = it; bestScore = score; }
    }
    return bestScore > 0 ? best : null;
  }

  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const activeWishes = () => S.wishes.filter((w) => !w.bought);
  function findWish(name) {
    const list = activeWishes();
    const n = norm(name);
    if (!n.trim()) return null;
    return list.find((w) => n.includes(norm(w.name))) || findByName(list, name);
  }
  // Estimativa de quando o desejo será atingido, pelo ritmo dos últimos 90 dias.
  function wishPace(w) {
    const remaining = w.price - w.saved;
    if (remaining <= 0) return '';
    const since = ymd(addDays(new Date(), -90));
    const recent = w.deposits.filter((d) => d.date >= since && d.amount > 0);
    if (!recent.length) return '';
    const first = recent.map((d) => d.date).sort()[0];
    const days = Math.max(14, (parseYmd(today()) - parseYmd(first)) / 86400000 + 1);
    const perDay = sum(recent) / days;
    if (perDay <= 0) return '';
    const need = Math.ceil(remaining / perDay);
    if (need <= 10) return `No seu ritmo, cerca de ${plural(need, 'dia', 'dias')}`;
    if (need <= 60) return `No seu ritmo, cerca de ${plural(Math.round(need / 7), 'semana', 'semanas')}`;
    return `No seu ritmo, cerca de ${plural(Math.round(need / 30), 'mês', 'meses')}`;
  }
  let wishCreated = false;

  // ---------- Ações (compartilhadas entre IA, interpretador local e formulários) ----------
  function applyActions(actions) {
    const chips = [];
    const gates = [];
    const { id } = commit(() => {
      for (const a of actions || []) {
        try { applyOne(a, chips, gates); } catch (e) { console.warn('Ação ignorada', a, e); }
      }
    });
    if (gates.length) gate(gates[0]);
    if (wishCreated) { wishCreated = false; offerNotifications(); }
    return { chips, undoId: chips.length ? id : null };
  }

  function applyOne(a, chips, gates) {
    switch (a && a.type) {
      case 'add_transaction': {
        const amount = Math.abs(Number(a.amount));
        if (!amount) return;
        const type = [a.kind, a.transaction_type, a.direction, a.tipo].includes('in') ? 'in' : 'out';
        const desc = cap(String(a.description || a.category || 'Lançamento').trim().slice(0, 80));
        let scope = a.scope === 'empresa' ? 'empresa' : 'pessoal';
        if (scope === 'empresa' && !allowed('business')) { scope = 'pessoal'; gates.push(`Contas da empresa fazem parte do plano ${planWith('business')?.name || 'superior'}.`); }
        S.tx.push({
          id: uid(), type, amount, desc,
          cat: CATS[a.category] ? a.category : guessCat(desc + ' ' + (a.category || ''), type),
          scope, date: isYmd(a.date) ? a.date : today(), auto: false, subId: null,
        });
        chips.push({ icon: type === 'in' ? 'in' : 'out', tone: type, label: `${type === 'in' ? '+' : '−'} ${money(amount)} · ${desc}` });
        return;
      }
      case 'add_task': {
        const title = cap(String(a.title || '').trim().slice(0, 120));
        if (!title) return;
        const due = isYmd(a.due) ? a.due : '';
        S.tasks.push({ id: uid(), title, prio: ['alta', 'media', 'baixa'].includes(a.priority) ? a.priority : 'media', due, time: /^\d{2}:\d{2}$/.test(a.time || '') ? a.time : '', done: false, doneAt: null });
        chips.push({ icon: 'tasks', tone: 'info', label: `${title}${due ? ' · ' + fmtDate(due) : ''}${a.time ? ' ' + a.time : ''}` });
        return;
      }
      case 'complete_task': {
        const t = findByName(S.tasks.filter((x) => !x.done), a.title, 'title');
        if (t) { t.done = true; t.doneAt = today(); chips.push({ icon: 'check', tone: 'in', label: t.title }); }
        return;
      }
      case 'add_habit': {
        const name = cap(String(a.name || '').trim().slice(0, 60));
        if (!name || S.habits.some((h) => norm(h.name) === norm(name))) return;
        if (!underLimit('habits', S.habits.length)) { gates.push(`Seu plano permite até ${limitOf('habits')} hábitos.`); return; }
        S.habits.push({ id: uid(), name, days: {}, created: today() });
        chips.push({ icon: 'flame', tone: 'amber', label: `Novo hábito: ${name}` });
        return;
      }
      case 'check_habit': {
        const h = findByName(S.habits, a.name);
        const day = isYmd(a.date) && a.date <= today() ? a.date : today();
        if (h) { h.days[day] = true; chips.push({ icon: 'flame', tone: 'amber', label: `${h.name} · ${plural(streak(h), 'dia seguido', 'dias seguidos')}` }); }
        return;
      }
      case 'add_goal': {
        const name = cap(String(a.name || '').trim().slice(0, 60));
        const target = Math.abs(Number(a.target));
        if (!name || !target) return;
        if (!underLimit('goals', S.goals.length)) { gates.push(`Seu plano permite até ${limitOf('goals')} meta(s).`); return; }
        S.goals.push({ id: uid(), name, target, saved: Math.abs(Number(a.saved)) || 0 });
        chips.push({ icon: 'target', tone: 'accent', label: `Meta: ${name} · ${money(target)}` });
        return;
      }
      case 'add_to_goal': {
        const g = findByName(S.goals, a.name) || (S.goals.length === 1 ? S.goals[0] : null);
        const amount = Number(a.amount);
        if (!g && findWish(a.name)) { applyOne({ ...a, type: 'add_to_wish' }, chips, gates); return; }
        if (g && amount) { g.saved = Math.max(0, g.saved + amount); chips.push({ icon: 'target', tone: 'accent', label: `${g.name}: ${money(g.saved)} de ${money(g.target)}` }); }
        return;
      }
      case 'add_wish': {
        const name = cap(String(a.name || '').trim().slice(0, 60));
        const price = Math.abs(Number(a.price ?? a.target ?? a.amount));
        if (!name || !price) return;
        if (activeWishes().some((w) => norm(w.name) === norm(name))) return;
        if (!underLimit('wishes', activeWishes().length)) { gates.push(`Seu plano permite até ${limitOf('wishes')} desejos de compra.`); return; }
        const saved = Math.max(0, Math.abs(Number(a.saved)) || 0);
        S.wishes.push({
          id: uid(), name, price, saved, link: /^https?:\/\//.test(a.link || '') ? a.link : '', created: today(),
          reachedAt: null, notified: false, bought: false, boughtAt: null, paid: 0, deposits: saved ? [{ date: today(), amount: saved }] : [],
        });
        chips.push({ icon: 'gift', tone: 'accent', label: `Quero comprar: ${name} · ${money(price)}` });
        wishCreated = true;
        return;
      }
      case 'add_to_wish': {
        const w = (a.id && S.wishes.find((x) => x.id === a.id)) || findWish(a.name) || (activeWishes().length === 1 ? activeWishes()[0] : null);
        const amount = Number(a.amount);
        if (!w || !amount) return;
        const before = w.saved;
        w.saved = Math.max(0, w.saved + amount);
        w.deposits.push({ date: today(), amount: w.saved - before });
        chips.push({ icon: 'gift', tone: 'accent', label: `${w.name}: ${money(w.saved)} de ${money(w.price)}` });
        return;
      }
      case 'buy_wish': {
        const w = (a.id && S.wishes.find((x) => x.id === a.id)) || findWish(a.name);
        if (!w || w.bought) return;
        const paid = Math.abs(Number(a.price_paid ?? a.amount)) || w.price;
        w.bought = true; w.boughtAt = today(); w.paid = paid;
        if (a.register_expense !== false) {
          S.tx.push({ id: uid(), type: 'out', amount: paid, desc: w.name, cat: 'Compras', scope: 'pessoal', date: today(), auto: false, subId: null });
        }
        chips.push({ icon: 'check', tone: 'in', label: `Comprado: ${w.name} · ${money(paid)}` });
        return;
      }
      case 'add_subscription': {
        const name = cap(String(a.name || '').trim().slice(0, 60));
        const amount = Math.abs(Number(a.amount));
        if (!name || !amount) return;
        const day = Math.min(31, Math.max(1, Number(a.day) || new Date().getDate()));
        S.subs.push({ id: uid(), name, amount, day, cat: 'Assinaturas', scope: 'pessoal', autoPost: true, lastPosted: initialLastPosted(day) });
        chips.push({ icon: 'repeat', tone: 'info', label: `${name} · ${money(amount)} todo dia ${day}` });
        return;
      }
      case 'set_budget': {
        const amount = Math.abs(Number(a.amount));
        if (!amount) return;
        S.settings.budget = amount;
        chips.push({ icon: 'wallet', tone: 'accent', label: `Orçamento: ${money(amount)} por mês` });
        return;
      }
    }
  }

  // Assinaturas viram lançamentos automaticamente no dia da cobrança.
  function postSubscriptions() {
    if (!allowed('autoSubs')) return false;
    const now = new Date();
    const key = monthKey(now);
    let changed = false;
    for (const s of S.subs) {
      if (s.autoPost === false || s.lastPosted === key) continue;
      const day = Math.min(s.day, daysInMonth(now.getFullYear(), now.getMonth()));
      if (now.getDate() < day) continue;
      S.tx.push({ id: uid(), type: 'out', amount: s.amount, desc: s.name, cat: s.cat || 'Assinaturas', scope: s.scope || 'pessoal', date: ymd(new Date(now.getFullYear(), now.getMonth(), day)), auto: true, subId: s.id });
      s.lastPosted = key;
      changed = true;
    }
    if (changed) save();
    return changed;
  }

  // ---------- Resumos em texto ----------
  function financeSummary() {
    const now = new Date();
    const list = monthTx(now.getFullYear(), now.getMonth());
    const t = totals(list);
    const cats = byCat(list).slice(0, 3).map(([c, v]) => `• ${c}: ${money(v)}`).join('\n');
    const budget = Number(S.settings.budget) || 0;
    return `**${cap(monthName(now.getFullYear(), now.getMonth()))} até agora**\n• Entradas: ${money(t.inc)}\n• Saídas: ${money(t.out)}\n• Saldo: ${money(t.bal)}` +
      (budget ? `\n\nVocê usou ${Math.round((t.out / budget) * 100)}% do orçamento de ${money(budget)}.` : '') +
      (cats ? `\n\n**Onde mais gastou**\n${cats}` : '');
  }
  function tasksSummary() {
    const open = S.tasks.filter((t) => !t.done).sort(sortTasks);
    if (!open.length) return 'Você não tem tarefas pendentes. Tudo em dia!';
    return `Você tem ${plural(open.length, 'tarefa pendente', 'tarefas pendentes')}:\n` +
      open.slice(0, 8).map((t) => `• ${t.title}${t.due ? ` (${fmtDate(t.due)}${t.time ? ' às ' + t.time : ''})` : ''}${t.prio === 'alta' ? ' **urgente**' : ''}`).join('\n');
  }
  function habitsSummary() {
    if (!S.habits.length) return 'Você ainda não tem hábitos. Diga, por exemplo: "criar hábito ler 10 páginas".';
    const done = S.habits.filter((h) => h.days[today()]).length;
    return `Hoje você fez ${done} de ${S.habits.length}:\n` + S.habits.map((h) => `• ${h.days[today()] ? 'Feito' : 'Falta'}: ${h.name} (${plural(streak(h), 'dia seguido', 'dias seguidos')})`).join('\n');
  }
  function wishesSummary() {
    const list = activeWishes();
    if (!list.length) return 'Sua lista de compras está vazia. Diga, por exemplo: "quero comprar uma bicicleta de 1500".';
    return '**Quero comprar**\n' + list.map((w) => `• ${w.name}: ${money(w.saved)} de ${money(w.price)}${w.saved >= w.price ? ' (pronto para comprar!)' : ` (faltam ${money(w.price - w.saved)})`}`).join('\n');
  }
  const HELP = 'Você pode me dizer coisas como:\n• "Gastei 35 no almoço"\n• "Recebi 1200 de um cliente da empresa"\n• "Me lembra de ligar pro dentista amanhã às 10h"\n• "Criar hábito ler 10 páginas" e depois "li 10 páginas"\n• "Quero comprar uma bicicleta de 1500"\n• "Meta de juntar 5000 para viagem"\n• "Assinatura Netflix 55 dia 10"\n• "Orçamento de 3000 por mês"\n• "Quanto gastei este mês?"';

  // ---------- Interpretador local (português) ----------
  const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|k)\b)?(\s*(?:reais|real|conto|pila))?/i;
  function amountValue(m) {
    let s = m[1];
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    let v = parseFloat(s);
    if (m[2]) v *= 1000;
    return v;
  }
  function parseAmount(text) {
    const m = text.match(AMOUNT_RE);
    return m ? { value: amountValue(m), raw: m[0], index: m.index } : null;
  }
  // Preço de um produto: prefere o número depois de "de", "por", "custa"... ("iphone 15 de 5000" = 5000).
  function priceAmount(text) {
    const re = new RegExp(AMOUNT_RE.source, 'gi');
    let m, best = null, last = null;
    while ((m = re.exec(text))) {
      const a = { value: amountValue(m), raw: m[0], index: m.index };
      last = a;
      if (/(custa|custando|por|de|valor|r\$|uns|umas)\s*$/.test(text.slice(Math.max(0, m.index - 14), m.index))) best = a;
    }
    return best || last;
  }
  function cleanItemName(x) {
    let s = x.replace(/[\s,.;:!?-]+$/, '').trim();
    s = s.replace(/^(um|uma|uns|umas|o|a|os|as|meu|minha|meus|minhas)\s+/i, '');
    let prev;
    do {
      prev = s;
      s = s.replace(/\s+(que custa|custando|custa|no valor de|por volta de|por uns|por umas|de uns|de umas|por|de|reais|real|r\$)$/i, '').replace(/[\s,.;:!?-]+$/, '').trim();
    } while (s !== prev);
    return cap(s);
  }

  const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  function parseDue(t) {
    const now = new Date();
    let due = '', time = '';
    const rawParts = [];
    const tm = t.match(/\b(?:as|a)\s*(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|horas)?\b/);
    if (tm && Number(tm[1]) < 24) { time = `${pad(tm[1])}:${tm[2] || '00'}`; rawParts.push(tm[0]); }
    if (/depois de amanha/.test(t)) { due = ymd(addDays(now, 2)); rawParts.push('depois de amanha'); }
    else if (/\bamanha\b/.test(t)) { due = ymd(addDays(now, 1)); rawParts.push('amanha'); }
    else if (/\bhoje\b/.test(t)) { due = today(); rawParts.push('hoje'); }
    else if (/\bontem\b/.test(t)) { due = ymd(addDays(now, -1)); rawParts.push('ontem'); }
    const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (!due && dm) {
      let y = dm[3] ? Number(dm[3]) : now.getFullYear();
      if (y < 100) y += 2000;
      due = ymd(new Date(y, Number(dm[2]) - 1, Number(dm[1])));
      rawParts.push(dm[0]);
    }
    const dd = t.match(/\bdia\s+(\d{1,2})\b/);
    if (!due && dd) {
      let d = new Date(now.getFullYear(), now.getMonth(), Number(dd[1]));
      if (d < parseYmd(today())) d = new Date(now.getFullYear(), now.getMonth() + 1, Number(dd[1]));
      due = ymd(d); rawParts.push(dd[0]);
    }
    if (!due) {
      for (let i = 0; i < 7; i++) {
        const m = t.match(new RegExp(`\\b(na |no |nesta |neste |proxima |proximo )?${WEEKDAYS[i]}(-feira)?\\b`));
        if (m) {
          const diff = (i - now.getDay() + 7) % 7 || 7;
          due = ymd(addDays(now, diff)); rawParts.push(m[0]);
          break;
        }
      }
    }
    return { due, time, rawParts };
  }

  function stripWords(text, words) {
    let s = ' ' + text + ' ';
    for (const w of words) s = s.replace(new RegExp(`\\s${w}(?=\\s)`, 'gi'), ' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  const STOP_MONEY = ['gastei', 'paguei', 'comprei', 'recebi', 'ganhei', 'vendi', 'entrou', 'caiu', 'torrei', 'me', 'pagaram', 'hoje', 'ontem', 'amanha', 'amanhã', 'com', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'em', 'pra', 'para', 'o', 'a', 'os', 'as', 'um', 'uma', 'reais', 'real', 'r\\$', 'eu', 'foi', 'pela', 'pelo', 'empresa', 'pessoal', 'mais', 'uns', 'umas', 'e'];
  const UNDO_RE = /^(desfaz(er)?|desfaca|cancela(r)?( isso)?|apaga (o|a) ultim[oa]|volta(r)?)\b/;

  function localParse(rawInput) {
    const input = String(rawInput).normalize('NFC').replace(/[!?.]+$/g, '').trim();
    const t = norm(input); // mesmo tamanho do input: índices batem para recuperar acentos
    const orig = (frag) => { const i = t.indexOf(frag); return i >= 0 ? input.slice(i, i + frag.length) : frag; };
    const amt = parseAmount(t);
    const name = S.settings.userName;

    if (/^(oi|ola|e ai|bom dia|boa tarde|boa noite|hey|opa)\b/.test(t) && t.split(' ').length <= 4) {
      return { reply: `${greeting()}${name ? ', ' + name : ''}! Como posso ajudar? Pode me contar um gasto, pedir um lembrete ou marcar um hábito.` };
    }
    if (/\b(obrigad[oa]|valeu|brigad[oa])\b/.test(t)) return { reply: 'Por nada! Estou aqui quando precisar.' };
    if (/\b(ajuda|o que voce faz|como funciona|comandos)\b/.test(t)) return { reply: HELP };

    // Consultas
    if (/\b(quanto (eu )?gastei|meus gastos|saldo|resumo financeiro|balanco|como estao (minhas )?financas|quanto (eu )?recebi)\b/.test(t)) return { reply: financeSummary() };
    if (/\b(minhas tarefas|quais (sao as )?tarefas|o que (eu )?(tenho|preciso) (pra|para|que) fazer|tarefas pendentes|lista de tarefas|minha agenda)\b/.test(t)) return { reply: tasksSummary() };
    if (/\b(meus habitos|como estao (meus )?habitos|habitos de hoje)\b/.test(t)) return { reply: habitsSummary() };
    if (/\b(minhas metas|como estao (minhas )?metas)\b/.test(t)) {
      return { reply: S.goals.length ? S.goals.map((g) => `• ${g.name}: ${money(g.saved)} de ${money(g.target)} (${Math.round((g.saved / (g.target || 1)) * 100)}%)`).join('\n') : 'Nenhuma meta ainda. Ex.: "meta de juntar 3000 para viagem".' };
    }

    // Orçamento
    if (/\b(orcamento|limite de gastos?|limite mensal)\b/.test(t) && amt) {
      return { actions: [{ type: 'set_budget', amount: amt.value }], reply: `Combinado. Vou te avisar quando os gastos chegarem perto de ${money(amt.value)} no mês.` };
    }

    // Assinaturas
    if (/\b(assinatura|mensalidade|assinei)\b/.test(t) && amt) {
      const day = (t.match(/\bdia\s+(\d{1,2})\b/) || [])[1];
      const subName = stripWords(orig(t).toLowerCase().replace(amt.raw, '').replace(/\bdia\s+\d{1,2}\b/, ''), ['assinatura', 'mensalidade', 'assinei', 'nova', 'do', 'da', 'de', 'o', 'a', 'por', 'mes', 'mês', 'mensal', 'todo', 'cobrada', 'no', 'na']) || 'Assinatura';
      return { actions: [{ type: 'add_subscription', name: subName, amount: amt.value, day }], reply: `Assinatura registrada. Vou considerar ${money(amt.value)} todo mês.` };
    }

    // Quero comprar (lista de desejos)
    if (/\b(lista de desejos|meus desejos|o que (eu )?quero comprar|lista de compras)\b/.test(t) && !/\b(adicion|coloc|incluir|bota)/.test(t)) return { reply: wishesSummary() };
    // "quero comprar X" é desejo; "vou comprar X" só vira desejo com preço e sem data (senão é tarefa).
    const strongWish = /\b(quero|desejo|sonho em|planejo|to juntando pra|estou juntando para|juntar dinheiro para|juntar dinheiro pra) comprar\b/.test(t) || /\b(lista de desejos|meta de compra)\b/.test(t);
    const weakWish = /\b(vou|pretendo) comprar\b/.test(t) && !!priceAmount(t) && !parseDue(t).due;
    if (strongWish || weakWish) {
      const m = t.match(/\b(?:comprar|desejos|meta de compra)[:\s]+(?:(?:na|a|minha) lista[:\s]+)?(.+)$/);
      if (m) {
        const segStart = t.length - m[1].length;
        const pa = priceAmount(t);
        let nameO = input.slice(segStart);
        if (pa && pa.index >= segStart) { const i = pa.index - segStart; nameO = nameO.slice(0, i) + ' ' + nameO.slice(i + pa.raw.length); }
        const itemName = cleanItemName(nameO.replace(/\s+/g, ' '));
        if (itemName) {
          const phrase = nameO.replace(/\s+/g, ' ').replace(/[\s,.;:!?-]+$/, '').trim();
          if (!pa) return { reply: `Quanto custa ${phrase}? Me diga assim: "quero comprar ${phrase} de 1500".` };
          return { actions: [{ type: 'add_wish', name: itemName, price: pa.value }], reply: `Coloquei na sua lista! Quando guardar dinheiro, me diga "guardei 200 para ${itemName}". Eu te aviso quando você atingir o valor.` };
        }
      }
    }
    if (/\b(comprei|finalmente comprei|ja comprei)\b/.test(t)) {
      const w = activeWishes().find((x) => t.includes(norm(x.name))) ||
        activeWishes().find((x) => norm(x.name).split(/\s+/).some((word) => word.length >= 4 && new RegExp(`\\b${escRe(word)}\\b`).test(t)));
      if (w) {
        const paid = amt ? amt.value : w.price;
        return { actions: [{ type: 'buy_wish', id: w.id, name: w.name, price_paid: paid, register_expense: true }], reply: `Que conquista! Marquei ${w.name} como comprado e lancei ${money(paid)} em Compras.` };
      }
    }

    // Metas
    if (/\bmeta\b/.test(t) && amt && /\b(criar|nova|meta de|quero|juntar|guardar|economizar)\b/.test(t) && !/\b(guardei|economizei|poupei|depositei)\b/.test(t)) {
      const nm = (t.match(/\b(?:para|pra|p\/)\s+(?:o |a |uma? )?(.+)$/) || [])[1];
      const goalName = nm ? orig(nm).replace(amt.raw, '').trim() : 'Minha meta';
      return { actions: [{ type: 'add_goal', name: goalName, target: amt.value }], reply: `Meta criada! Quando guardar dinheiro, me diga: "guardei 100 para ${goalName}".` };
    }
    if (/\b(guardei|economizei|poupei|depositei|separei|juntei|reservei|coloquei)\b/.test(t) && amt) {
      const rest = t.replace(amt.raw, ' ');
      const wExact = activeWishes().find((x) => t.includes(norm(x.name)));
      const gExact = S.goals.find((x) => t.includes(norm(x.name)));
      const both = [...activeWishes(), ...S.goals];
      const w = wExact || (!gExact && findWish(rest)) || null;
      const g = !w ? gExact || findByName(S.goals, rest) : null;
      if (w) {
        const falta = w.price - w.saved - amt.value;
        return { actions: [{ type: 'add_to_wish', id: w.id, name: w.name, amount: amt.value }], reply: falta > 0 ? `Boa! Faltam ${money(falta)} para ${w.name}.` : `Boa! Guardado para ${w.name}.` };
      }
      if (g) return { actions: [{ type: 'add_to_goal', name: g.name, amount: amt.value }], reply: 'Boa! Cada passo conta.' };
      if (both.length === 1) {
        const only = both[0];
        return { actions: [{ type: S.wishes.includes(only) ? 'add_to_wish' : 'add_to_goal', id: only.id, name: only.name, amount: amt.value }], reply: 'Boa! Cada passo conta.' };
      }
      return { reply: both.length ? `Para qual meta? Me diga assim: "guardei ${amt.value} para ${both[0].name}".` : 'Você ainda não tem metas. Crie uma assim: "quero comprar uma bicicleta de 1500" ou "meta de juntar 2000 para reserva".' };
    }

    // Criar hábito
    const hm = t.match(/\b(?:criar|novo|nova|adicionar|comecar)\s+(?:o\s+|um\s+)?(?:habito|rotina)\s+(?:de\s+)?(.+)$/) || t.match(/^(?:habito|rotina)[:\s]+(?:de\s+)?(.+)$/) || t.match(/\bquero criar o habito de\s+(.+)$/);
    if (hm) return { actions: [{ type: 'add_habit', name: orig(hm[1]) }], reply: `Hábito criado! Quando fizer, é só me dizer "fiz ${orig(hm[1])}". Vou acompanhar sua sequência.` };

    // Concluir hábito ou tarefa
    const doneVerb = /\b(fiz|feito|feita|conclui|terminei|completei|marquei|marca|marcar|ja|finalizei|resolvi|bebi|li|treinei|meditei|corri|estudei|caminhei)\b/.test(t);
    if (doneVerb) {
      const h = S.habits.find((x) => t.includes(norm(x.name))) || (S.habits.length ? findByName(S.habits, stripWords(t, ['fiz', 'feito', 'marquei', 'marca', 'hoje', 'ja', 'o', 'a', 'habito', 'de'])) : null);
      const tk = findByName(S.tasks.filter((x) => !x.done), stripWords(t, ['conclui', 'terminei', 'finalizei', 'resolvi', 'fiz', 'feito', 'feita', 'a', 'o', 'tarefa', 'de', 'ja']), 'title');
      if (h && !/\btarefa\b/.test(t)) return { actions: [{ type: 'check_habit', name: h.name }], reply: 'Mandou bem! Hábito marcado para hoje.' };
      if (tk && !amt) return { actions: [{ type: 'complete_task', title: tk.title }], reply: 'Tarefa concluída. Menos uma!' };
    }

    // Dinheiro
    const outVerb = /\b(gastei|paguei|comprei|gasto|despesa|saiu|torrei|pagar(?:am)?\s+(?:a|o)|conta de)\b/.test(t);
    const inVerb = /\b(recebi|ganhei|vendi|entrou|receita|salario|faturei|caiu|me pagaram|pix de)\b/.test(t);
    const taskHint = /\b(lembr|lembrete|tarefa|preciso|tenho que|nao esquecer|nao deixar)/.test(t);
    if (amt && (outVerb || inVerb) && !taskHint) {
      const type = inVerb && !outVerb ? 'in' : 'out';
      const { due } = parseDue(t);
      const date = due && due <= today() ? due : today();
      // "gastei 30 no uber e 50 no mercado" vira dois lançamentos.
      const parts = t.split(/\s+e\s+|,\s+|;\s*/).filter((seg) => parseAmount(seg));
      const segs = parts.length > 1 ? parts : [t];
      const actions = segs.map((seg) => {
        const a = parseAmount(seg);
        const desc = stripWords(orig(seg).toLowerCase().replace(a.raw, ''), STOP_MONEY) || guessCat(seg, type);
        return { type: 'add_transaction', kind: type, amount: a.value, description: desc, category: guessCat(seg, type), scope: guessScope(t), date };
      });
      return { actions, reply: () => (type === 'in' ? 'Entrada registrada!' : 'Gasto registrado. ' + budgetHint()) };
    }

    // Tarefas
    if (taskHint || /\b(me lembra|agendar|marcar consulta|ligar para|ligar pra|comprar|pagar|enviar|mandar|buscar|levar)\b/.test(t)) {
      const { due, time, rawParts } = parseDue(t);
      let title = input;
      let n = norm(title);
      const prefixes = /^(me\s+lembr[ae]\s+(de\s+)?|lembr[ae]r?(-me)?\s+(de\s+|que\s+)?|lembrete[:\s]+(de\s+|para\s+)?|nova\s+tarefa[:\s]+|tarefa[:\s]+|adicionar\s+tarefa[:\s]+|preciso\s+(de\s+)?|tenho\s+que\s+|(eu\s+)?vou\s+(ter\s+que\s+)?|nao\s+(posso\s+)?esquecer\s+(de\s+)?|nao\s+deixar\s+de\s+)/;
      const pm = n.match(prefixes);
      if (pm) { title = title.slice(pm[0].length); n = n.slice(pm[0].length); }
      for (const r of rawParts) {
        const i = n.indexOf(r);
        if (i >= 0) { title = title.slice(0, i) + title.slice(i + r.length); n = n.slice(0, i) + n.slice(i + r.length); }
      }
      title = title.replace(/\b(urgente|importante|sem pressa|quando der)\b/gi, '').replace(/\s+/g, ' ').replace(/[\s,.-]+$/, '').trim();
      const prio = /\b(urgente|importante|prioridade)\b/.test(t) ? 'alta' : /\b(sem pressa|quando der|qualquer dia)\b/.test(t) ? 'baixa' : 'media';
      if (title) {
        return {
          actions: [{ type: 'add_task', title, priority: prio, due, time }],
          reply: `Pode deixar, vou te lembrar${due ? ' ' + fmtDate(due) : ''}${time ? ' às ' + time : ''}.`,
        };
      }
    }

    if (amt) return { reply: `Entendi o valor de ${money(amt.value)}, mas foi um gasto ou uma entrada? Ex.: "gastei ${amt.value} no mercado" ou "recebi ${amt.value}".` };
    return { reply: 'Não entendi muito bem.\n' + HELP };
  }
  function budgetHint() {
    const now = new Date();
    const t = totals(monthTx(now.getFullYear(), now.getMonth()));
    const budget = Number(S.settings.budget) || 0;
    if (!budget) return `Total de gastos no mês: ${money(t.out)}.`;
    const left = budget - t.out;
    return left >= 0 ? `Ainda restam ${money(left)} do seu orçamento do mês.` : `Atenção: você passou ${money(-left)} do orçamento do mês.`;
  }

  // ---------- IA ----------
  // Mantenha estas regras em sincronia com server/src/index.js.
  const AI_RULES = `Você é o Zeny, um assistente pessoal brasileiro, simpático e objetivo, que organiza finanças (pessoais e da empresa), hábitos e tarefas do usuário a partir de mensagens de texto ou voz transcrita.

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
- Calcule datas relativas (amanhã, sexta, dia 15) a partir da data de hoje do contexto.
- "Quero comprar X de R$ Y" é um desejo de compra (add_wish). Metas sem um item específico (reserva, viagem) usam add_goal.
- "Guardei 200 para X": use add_to_wish se X estiver em desejos_de_compra, senão add_to_goal.
- Quando um desejo ou meta atinge o valor, o app avisa a pessoa sozinho. Você não precisa avisar.
- Para perguntas (quanto gastei, o que tenho pra fazer, quanto falta para comprar algo, dicas), responda usando os dados do contexto, sem ações.
- Se faltar informação essencial (ex.: valor), pergunte na "reply" e não crie a ação.
- Respostas curtas e calorosas. Use R$ no formato brasileiro. Pode usar **negrito** e listas com "• ".
- Siga o campo "personalidade" do contexto.
- Você só ajuda com finanças pessoais, hábitos, tarefas e organização do dia a dia.`;

  function aiContext() {
    const now = new Date();
    const list = monthTx(now.getFullYear(), now.getMonth());
    const t = totals(list);
    return JSON.stringify({
      hoje: today(),
      dia_da_semana: WEEKDAYS[now.getDay()],
      nome_usuario: S.settings.userName || null,
      personalidade: S.settings.persona === 'genio'
        ? 'Gênio: confiante, espirituoso e rápido, com humor leve e um pouco de ironia elegante, como um inventor brilhante. Chame o usuário de "chefe" às vezes. Frases curtas e marcantes. Nunca seja grosseiro e nunca diga que é um personagem ou pessoa famosa.'
        : 'Padrão: simpático, claro e acolhedor.',
      orcamento_mensal: Number(S.settings.budget) || null,
      mes_atual: { entradas: t.inc, saidas: t.out, saldo: t.bal, por_categoria: Object.fromEntries(byCat(list)) },
      lancamentos_recentes: S.tx.slice(-25).map(({ type, amount, desc, cat, scope, date }) => ({ tipo: type, valor: amount, desc, cat, scope, date })),
      metas: S.goals.map(({ name, target, saved }) => ({ name, target, saved })),
      desejos_de_compra: activeWishes().map(({ name, price, saved }) => ({ name, preco: price, guardado: saved, falta: Math.max(0, price - saved) })),
      assinaturas: S.subs.map(({ name, amount, day }) => ({ name, amount, day })),
      habitos: S.habits.map((h) => ({ name: h.name, feito_hoje: !!h.days[today()], sequencia: streak(h) })),
      tarefas_pendentes: S.tasks.filter((x) => !x.done).map(({ title, prio, due, time }) => ({ title, prio, due, time })),
    });
  }

  let sampleFn = null;
  let sampleOff = false;
  let downloadsApi = null;
  const serverUrl = () => (S.settings.serverUrl || CFG.serverUrl || '').trim().replace(/\/+$/, '');
  const aiMode = () => (sampleFn && !sampleOff ? 'claude' : serverUrl() ? 'server' : 'local');
  const AI_LABEL = { claude: 'IA do Claude ativa', server: 'IA conectada', local: 'Modo local' };

  function normalizeAi(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw { code: 'invalid_json' };
    return { reply: String(data.reply || ''), actions: Array.isArray(data.actions) ? data.actions : [] };
  }
  async function askSample(text) {
    const turns = [{ role: 'user', content: AI_RULES }];
    for (const m of S.chat.slice(-11, -1)) {
      if (m.text) turns.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 1500) });
    }
    turns.push({ role: 'user', content: `Contexto atual (JSON):\n${aiContext()}\n\nMensagem do usuário:\n${text}` });
    return normalizeAi(await sampleFn.json(turns, { modelTier: 'quick', cache: false }));
  }
  async function askServer(text) {
    const history = S.chat.slice(-13, -1).map(({ role, text: tx }) => ({ role, text: tx }));
    const res = await fetch(serverUrl() + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, history, context: aiContext() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: res.status === 429 ? 'rate_limited' : 'upstream_error', message: data.error };
    return normalizeAi(data);
  }
  function aiQuotaOk() {
    const key = monthKey(new Date());
    if (S.usage.month !== key) S.usage = { month: key, ai: 0 };
    return underLimit('aiMessages', S.usage.ai);
  }
  function countAi() {
    const key = monthKey(new Date());
    if (S.usage.month !== key) S.usage = { month: key, ai: 0 };
    S.usage.ai++;
  }
  function handleAiError(e, mode) {
    const code = e && e.code;
    if (mode === 'claude' && ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
      sampleOff = true;
      renderAiStatus();
      toast('A IA do Claude não foi liberada nesta página. Respondi no modo local.');
    } else if (code === 'rate_limited') {
      toast(e.message || 'Muitas mensagens seguidas. Respondi no modo local.');
    } else {
      console.warn('IA', e);
      toast('A IA não respondeu agora. Respondi no modo local.');
    }
  }

  // ---------- Personalidade ----------
  const QUIPS = {
    out: ['Registrado. Todo gênio precisa de um orçamento, chefe.', 'Anotado. O dinheiro saiu, mas o controle continua aqui.', 'Feito. Gastar com estratégia também é uma arte.'],
    in: ['Dinheiro entrando. É assim que eu gosto.', 'Excelente. O caixa agradece, chefe.', 'Registrado. Fluxo de caixa positivo é o meu tipo de notícia.'],
    task: ['Anotado. Eu não esqueço nada, é um dos meus talentos.', 'Deixa comigo. Na hora certa, eu te lembro.', 'Agendado. Considere isso resolvido.'],
    done: ['Missão cumprida. Próxima?', 'Concluído com estilo.'],
    habit: ['Consistência: a melhor armadura que existe.', 'Mais um dia na sequência. Impressionante, chefe.'],
    wish: ['Na lista. Vamos transformar esse desejo em compra.', 'Anotado. Guardando aos poucos, a gente chega lá.'],
    save: ['Mais perto do objetivo. Gosto do plano.', 'Guardado. Paciência também é tecnologia.'],
    hello: ['Olá, chefe. Sistemas online. O que vamos resolver hoje?', 'De volta ao trabalho, chefe? Estou pronto.'],
  };
  const QUIP_KIND = { add_transaction: (a) => ([a.kind, a.transaction_type, a.direction].includes('in') ? 'in' : 'out'), add_task: 'task', complete_task: 'done', add_habit: 'habit', check_habit: 'habit', add_wish: 'wish', add_to_wish: 'save', add_to_goal: 'save', add_goal: 'save', buy_wish: 'done' };
  let quipTurn = 0;
  function withPersona(result) {
    if (S.settings.persona !== 'genio') return result;
    const first = (result.actions || [])[0];
    let kind = null;
    if (first && QUIP_KIND[first.type]) kind = typeof QUIP_KIND[first.type] === 'function' ? QUIP_KIND[first.type](first) : QUIP_KIND[first.type];
    else if (/^(Bom dia|Boa tarde|Boa noite)/.test(typeof result.reply === 'string' ? result.reply : '')) kind = 'hello';
    if (!kind) return result;
    const list = QUIPS[kind];
    const quip = list[quipTurn++ % list.length];
    if (kind === 'hello') return { ...result, reply: quip };
    const base = result.reply;
    return {
      ...result,
      reply: () => {
        const r = typeof base === 'function' ? base() : base;
        if (kind === 'out' || kind === 'in') return `${quip} ${r.replace(/^(Gasto registrado\.|Entrada registrada!)\s*/, '')}`.trim();
        if (kind === 'task') return `${quip}${first.due ? ` Te lembro ${fmtDate(first.due)}${first.time ? ' às ' + first.time : ''}.` : ''}`;
        if (kind === 'save') return `${quip} ${r.replace(/^Boa!\s*(Cada passo conta\.)?\s*/, '')}`.trim();
        return quip;
      },
    };
  }

  // ---------- Chat ----------
  function formatText(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split('\n');
    let html = '', list = [], para = [];
    const flushP = () => { if (para.length) { html += `<p>${para.join('<br>')}</p>`; para = []; } };
    const flushL = () => { if (list.length) { html += `<ul>${list.map((l) => `<li><span>${l}</span></li>`).join('')}</ul>`; list = []; } };
    for (const line of lines) {
      const m = line.match(/^\s*(?:•|-|\*)\s+(.*)$/);
      if (m) { flushP(); list.push(m[1]); } else if (!line.trim()) { flushP(); flushL(); } else { flushL(); para.push(line); }
    }
    flushP(); flushL();
    return html;
  }

  function msgHtml(m) {
    const receipt = m.chips && m.chips.length ? `
      <div class="receipt ${m.undone ? 'undone' : ''}">
        ${m.chips.map((c) => `<div class="r-row"><span class="r-ic tone-${esc(c.tone || 'accent')}">${ic(c.icon || 'check')}</span><span>${esc(c.label)}</span></div>`).join('')}
        ${m.undoId ? `<div class="r-foot">${m.undone ? '<span class="small muted">Desfeito</span>' : `<button type="button" data-act="undo" data-id="${esc(m.undoId)}">${ic('undo', 'sm')}Desfazer</button>`}</div>` : ''}
      </div>` : '';
    const bubble = m.role === 'user' ? `<div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}</div>` : `<div class="bubble">${formatText(m.text)}</div>`;
    return `${bubble}${receipt}<span class="time">${fmtTime(m.at)}</span>`;
  }

  function renderChat() {
    const box = $('#messages');
    let html = '', lastDay = '';
    for (const m of S.chat) {
      const d = ymd(new Date(m.at));
      if (d !== lastDay) { html += `<div class="day-sep">${esc(dayLabel(d))}</div>`; lastDay = d; }
      html += `<div class="msg ${m.role}" data-mid="${esc(m.id)}">${msgHtml(m)}</div>`;
    }
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }
  function addMsg(m) {
    const msg = { id: uid(), at: Date.now(), chips: [], undoId: null, undone: false, ...m };
    const prev = S.chat[S.chat.length - 1];
    S.chat.push(msg);
    if (S.chat.length > 200) S.chat = S.chat.slice(-200);
    save();
    const box = $('#messages');
    const d = ymd(new Date(msg.at));
    if (!prev || ymd(new Date(prev.at)) !== d) box.insertAdjacentHTML('beforeend', `<div class="day-sep">${esc(dayLabel(d))}</div>`);
    box.insertAdjacentHTML('beforeend', `<div class="msg ${msg.role} fresh" data-mid="${esc(msg.id)}">${msgHtml(msg)}</div>`);
    box.scrollTop = box.scrollHeight;
    return msg;
  }
  function showTyping() {
    const box = $('#messages');
    const el = document.createElement('div');
    el.className = 'msg bot fresh';
    el.innerHTML = '<div class="bubble typing" aria-label="Zeny está digitando"><i></i><i></i><i></i></div>';
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function suggestionList() {
    const s = [];
    s.push(S.tx.length ? 'Quanto gastei este mês?' : 'Gastei 45 no mercado');
    s.push('O que tenho pra fazer hoje?');
    const pendingHabit = S.habits.find((h) => !h.days[today()]);
    s.push(pendingHabit ? `Fiz ${pendingHabit.name.toLowerCase()}` : S.habits.length ? 'Meus hábitos' : 'Criar hábito beber água');
    s.push('Me lembra de pagar a luz sexta');
    if (!S.wishes.length) s.push('Quero comprar uma bicicleta de 1500');
    else if (activeWishes().length) s.push(`Guardei 100 para ${activeWishes()[0].name.toLowerCase()}`);
    if (!S.goals.length) s.push('Meta de juntar 5000 para viagem');
    if (!S.settings.budget) s.push('Orçamento de 3000 por mês');
    s.push('Recebi 2500 de salário');
    return s.slice(0, 7);
  }
  function renderSuggestions() {
    $('#suggestions').innerHTML = suggestionList().map((x) => `<button type="button" data-act="suggest">${esc(x)}</button>`).join('');
  }

  let busy = false;
  async function handleUser(raw) {
    const text = String(raw || '').trim().slice(0, 2000);
    if (!text || busy) return;
    busy = true;
    setComposer();
    addMsg({ role: 'user', text });

    if (UNDO_RE.test(norm(text))) {
      const ok = undoStack.length ? undo() : false;
      addMsg({ role: 'bot', text: ok ? 'Pronto, desfiz a última alteração.' : 'Não há nada para desfazer agora.' });
      busy = false; setComposer();
      return;
    }

    const typing = showTyping();
    const started = Date.now();
    const mode = aiMode();
    let result = null;
    try {
      if (mode !== 'local') {
        if (aiQuotaOk()) {
          try {
            result = mode === 'claude' ? await askSample(text) : await askServer(text);
            countAi();
          } catch (e) { handleAiError(e, mode); }
        } else {
          gate(`Você usou as ${limitOf('aiMessages')} mensagens com a IA do plano ${currentPlan().name} este mês.`);
        }
      }
      if (!result) result = withPersona(localParse(text));
      const wait = 420 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    } catch (e) {
      console.error(e);
      result = { reply: 'Tive um problema para entender isso. Pode tentar de outro jeito?' };
    } finally {
      typing.remove();
    }

    const { chips, undoId } = result.actions && result.actions.length ? applyActions(result.actions) : { chips: [], undoId: null };
    let reply = typeof result.reply === 'function' ? result.reply() : result.reply;
    if (!reply) reply = chips.length ? 'Pronto, anotei.' : 'Certo.';
    addMsg({ role: 'bot', text: reply, chips, undoId });
    speak(reply);
    busy = false;
    setComposer();
    renderSuggestions();
  }

  function setComposer() {
    const input = $('#input');
    $('#sendBtn').disabled = busy || !input.value.trim();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  // ---------- Notificações ----------
  // Android (Capacitor): LocalNotifications. Navegador: Notification API. Sempre há o aviso dentro do app.
  let notifStatus = 'unknown'; // granted | denied | default | unsupported
  async function refreshNotifStatus() {
    const ln = plugin('LocalNotifications');
    if (ln) {
      try { const p = await ln.checkPermissions(); notifStatus = p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default'; } catch (e) { notifStatus = 'unsupported'; }
    } else if (!('Notification' in window) || window.claude) {
      notifStatus = 'unsupported';
    } else {
      notifStatus = Notification.permission;
    }
    return notifStatus;
  }
  async function requestNotifications() {
    const ln = plugin('LocalNotifications');
    let ok = false;
    if (ln) {
      try { ok = (await ln.requestPermissions()).display === 'granted'; } catch (e) { ok = false; }
    } else if ('Notification' in window && !window.claude) {
      try { ok = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'; } catch (e) { ok = false; }
    }
    await refreshNotifStatus();
    S.settings.notify = ok;
    save();
    toast(ok ? 'Avisos ativados. O Zeny te avisa quando você atingir uma meta.' : notifStatus === 'unsupported' ? 'Aqui os avisos aparecem dentro do app.' : 'Os avisos foram bloqueados. Libere nas configurações do navegador ou do celular.');
    if (current === 'settings' || current === 'wishes') renderMain();
    return ok;
  }
  function offerNotifications() {
    if (notifStatus !== 'default' || S.settings.notifyAsked) return;
    S.settings.notifyAsked = true;
    save();
    setTimeout(() => toast('Quer receber um aviso quando atingir o valor?', { label: 'Ativar avisos', fn: () => requestNotifications() }), 900);
  }
  async function systemNotify(title, body, tag) {
    if (S.settings.notify === false || notifStatus !== 'granted') return false;
    const ln = plugin('LocalNotifications');
    try {
      if (ln) {
        await ln.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title, body, schedule: { at: new Date(Date.now() + 800) } }] });
        return true;
      }
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg && reg.showNotification) await reg.showNotification(title, { body, icon: 'icon.svg', badge: 'icon.svg', tag });
      else new Notification(title, { body, icon: 'icon.svg', tag });
      return true;
    } catch (e) { return false; }
  }

  let celebrating = false;
  async function flushCelebrations() {
    if (celebrating) return;
    celebrating = true;
    try {
      while (pendingCelebrations.length) {
        const c = pendingCelebrations.shift();
        if (c.kind === 'wish') {
          const w = S.wishes.find((x) => x.id === c.id);
          if (!w || w.bought || w.saved < w.price) continue;
          const body = `Você já juntou ${money(w.saved)} para ${w.name}. Já pode comprar!`;
          systemNotify('Meta atingida!', body, 'wish-' + w.id);
          addMsg({ role: 'bot', text: `**Meta atingida!** Você já juntou ${money(w.saved)} para **${w.name}**. Já pode comprar!\nQuando comprar, me diga "comprei ${w.name}".` });
          if (!$('#modal').open) {
            const r = await openForm('Meta atingida!', [], { intro: body, ok: 'Registrar compra', cancel: 'Depois', celebrate: true, noFocus: true });
            if (r) await buyForm(w);
          }
        } else {
          const g = S.goals.find((x) => x.id === c.id);
          if (!g || g.saved < g.target) continue;
          const body = `Você completou a meta ${g.name}: ${money(g.saved)} guardados.`;
          systemNotify('Meta concluída!', body, 'goal-' + g.id);
          addMsg({ role: 'bot', text: `**Meta concluída!** Você juntou ${money(g.saved)} para **${g.name}**. Parabéns!` });
          toast(`Meta concluída: ${g.name}!`);
        }
      }
    } finally {
      celebrating = false;
    }
  }

  // ---------- Voz ----------
  const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = (name) => native() && window.Capacitor.Plugins && window.Capacitor.Plugins[name];

  // Estilos: "confiante" deixa a voz mais grave e um pouco mais rápida.
  const VOICE_STYLES = { padrao: { rate: 1, pitch: 1 }, confiante: { rate: 1.08, pitch: 0.78 }, calma: { rate: 0.9, pitch: 0.95 } };
  const MALE_HINT = /(daniel|felipe|ricardo|antonio|antônio|fabio|fábio|thiago|humberto|donato|julio|júlio|nicolau|valerio|male|masculin)/i;
  function ptVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => /^pt/i.test(v.lang)).sort((a, b) => (b.lang === 'pt-BR') - (a.lang === 'pt-BR') || a.name.localeCompare(b.name));
  }
  function pickVoice() {
    const list = ptVoices();
    if (!list.length) return null;
    const chosen = list.find((v) => v.voiceURI === S.settings.voiceURI);
    if (chosen) return chosen;
    if (S.settings.voiceStyle === 'confiante' || S.settings.persona === 'genio') {
      const male = list.find((v) => v.lang === 'pt-BR' && MALE_HINT.test(v.name)) || list.find((v) => MALE_HINT.test(v.name));
      if (male) return male;
    }
    return list.find((v) => v.lang === 'pt-BR') || list[0];
  }
  function speak(text, force = false) {
    if ((!S.settings.speak && !force) || !text) return;
    const clean = text.replace(/\*\*/g, '').replace(/[•\u{1F300}-\u{1FAFF}☀-➿]/gu, '');
    const style = VOICE_STYLES[S.settings.voiceStyle] || VOICE_STYLES.padrao;
    const tts = plugin('TextToSpeech');
    if (tts) { tts.stop().catch(() => {}).finally(() => tts.speak({ text: clean, lang: 'pt-BR', rate: style.rate, pitch: style.pitch }).catch(() => {})); return; }
    if (!('speechSynthesis' in window)) { if (force) toast('Este navegador não consegue falar.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'pt-BR';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = style.rate;
    u.pitch = style.pitch;
    speechSynthesis.speak(u);
  }
  const SAMPLE = () => (S.settings.persona === 'genio'
    ? `Olá, ${S.settings.userName || 'chefe'}. Sistemas online. Seu saldo está sob controle e eu cuido do resto.`
    : `Olá${S.settings.userName ? ', ' + S.settings.userName : ''}! Eu sou o Zeny. Pode me contar um gasto, pedir um lembrete ou marcar um hábito.`);

  function setupVoice() {
    const btn = $('#micBtn');
    const nativeSR = plugin('SpeechRecognition');
    if (nativeSR) {
      let listening = false;
      btn.addEventListener('click', async () => {
        if (listening) { nativeSR.stop().catch(() => {}); return; }
        try {
          const { available } = await nativeSR.available();
          if (!available) { toast('Reconhecimento de voz indisponível neste aparelho.'); return; }
          const perm = await nativeSR.requestPermissions();
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') { toast('Permita o uso do microfone para falar com o Zeny.'); return; }
          listening = true; btn.classList.add('rec');
          const { matches } = await nativeSR.start({ language: 'pt-BR', maxResults: 1, partialResults: false, popup: false, prompt: 'Fale com o Zeny' });
          if (matches && matches[0]) handleUser(matches[0]);
        } catch (e) {
          if (!/no match|cancel/i.test(String(e && e.message))) toast('Não consegui ouvir. Tente de novo.');
        } finally {
          listening = false; btn.classList.remove('rec');
        }
      });
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.addEventListener('click', () => toast('Seu navegador não reconhece voz. Use o Chrome ou digite a mensagem.'));
      return;
    }
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    let listening = false;
    rec.onresult = (e) => {
      let interim = '', finalText = '';
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      $('#input').value = finalText || interim;
      setComposer();
    };
    rec.onend = () => {
      listening = false;
      btn.classList.remove('rec');
      const v = $('#input').value;
      if (v.trim()) { $('#input').value = ''; handleUser(v); }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('O microfone está bloqueado nesta página. Libere o acesso ou digite a mensagem.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Não consegui usar o microfone agora.');
    };
    btn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      $('#input').value = '';
      try { rec.start(); listening = true; btn.classList.add('rec'); } catch (e) { /* já iniciado */ }
    });
  }

  // ---------- Navegação ----------
  const VIEWS = ['home', 'finance', 'wishes', 'habits', 'tasks', 'plans', 'settings'];
  let current = VIEWS.includes(S.settings.lastView) ? S.settings.lastView : 'home';
  const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

  function go(view) {
    const shell = $('#shell');
    if (view === 'chat') {
      shell.classList.add('chat-open');
      setTimeout(() => { $('#messages').scrollTop = $('#messages').scrollHeight; if (isDesktop()) $('#input').focus(); }, 30);
      return;
    }
    if (view === 'back') { shell.classList.remove('chat-open'); return; }
    if (!VIEWS.includes(view)) return;
    shell.classList.remove('chat-open');
    current = view;
    S.settings.lastView = view;
    save();
    renderMain();
    $('#main').scrollTop = 0;
  }

  // ---------- Interface: pedaços reutilizáveis ----------
  const emptyState = (icon, title, text, action = '') => `<div class="empty"><span class="e-ic">${ic(icon)}</span><strong>${title}</strong><span>${text}</span>${action}</div>`;
  function ring(done, total) {
    const c = 2 * Math.PI * 19;
    const p = total ? done / total : 0;
    return `<svg class="ring" viewBox="0 0 44 44" role="img" aria-label="${done} de ${total}"><circle class="track" cx="22" cy="22" r="19"/><circle class="val" cx="22" cy="22" r="19" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}"/><text x="22" y="26" text-anchor="middle">${done}/${total}</text></svg>`;
  }
  function dueChip(t) {
    if (!t.due) return '';
    const overdue = !t.done && t.due < today();
    const tone = overdue ? 'tone-out' : t.due === today() ? 'tone-accent' : '';
    return `<span class="pill ${tone}">${ic(overdue ? 'alert' : 'clock')}${overdue ? 'Atrasada · ' : ''}${esc(cap(fmtDate(t.due)))}${t.time ? ' ' + esc(t.time) : ''}</span>`;
  }
  function taskRow(t) {
    const prio = t.prio === 'alta' ? '<span class="pill tone-out">Alta</span>' : t.prio === 'baixa' ? '<span class="pill">Baixa</span>' : '';
    const meta = [dueChip(t), prio, t.done && t.doneAt ? `<span>Concluída ${esc(fmtDate(t.doneAt))}</span>` : ''].filter(Boolean).join('');
    return `<div class="row ${t.done ? 'done' : ''}">
      <button type="button" class="checkbox ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Reabrir' : 'Concluir'} ${esc(t.title)}">${ic('check')}</button>
      <button type="button" class="grow" data-act="task-edit" data-id="${t.id}" style="text-align:left">
        <span class="title">${esc(t.title)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}
      </button>
    </div>`;
  }
  function txRow(x) {
    const tags = [esc(x.cat), x.scope === 'empresa' ? `<span class="pill">${ic('briefcase')}Empresa</span>` : '', x.auto ? `<span class="pill">${ic('repeat')}Automático</span>` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="row" data-act="tx-edit" data-id="${x.id}">
      ${catIcon(x.cat)}
      <span class="grow"><span class="title">${esc(x.desc)}</span><span class="meta">${tags}</span></span>
      <span class="amount ${x.type === 'in' ? 'pos' : ''}">${x.type === 'in' ? '+' : '−'} ${money(x.amount)}</span>
    </button>`;
  }
  const demoBanner = () => (S.demo ? `<div class="demo-banner"><span><strong>Dados de exemplo.</strong> Explore à vontade: nada disso é real.</span><button type="button" class="btn sm ghost" data-act="clear-demo">Começar do zero</button></div>` : '');

  // ---------- Tela: Início ----------
  function insights() {
    const out = [];
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const monthList = monthTx(y, m);
    const curOut = sum(monthList.filter((t) => t.type === 'out'));
    const prev = new Date(y, m - 1, 1);
    const prevOut = sum(monthTx(prev.getFullYear(), prev.getMonth()).filter((t) => t.type === 'out' && parseYmd(t.date).getDate() <= now.getDate()));
    if (curOut > 0 && prevOut > 0) {
      const diff = (curOut - prevOut) / prevOut;
      if (Math.abs(diff) >= 0.05) out.push({ icon: diff > 0 ? 'up' : 'down', tone: diff > 0 ? 'out' : 'in', html: `Você gastou <b>${Math.round(Math.abs(diff) * 100)}% ${diff > 0 ? 'a mais' : 'a menos'}</b> que no mesmo período de ${monthName(prev.getFullYear(), prev.getMonth())}.` });
    }
    const budget = Number(S.settings.budget) || 0;
    if (budget && curOut) {
      const left = budget - curOut;
      const daysLeft = daysInMonth(y, m) - now.getDate() + 1;
      if (left < 0) out.push({ icon: 'alert', tone: 'out', html: `Você passou <b>${money(-left)}</b> do orçamento do mês.` });
      else if (curOut / budget >= 0.7) out.push({ icon: 'wallet', tone: 'amber', html: `Restam <b>${money(left)}</b> do orçamento para ${plural(daysLeft, 'dia', 'dias')}: cerca de ${money(left / daysLeft)} por dia.` });
    }
    const cats = byCat(monthList);
    if (cats.length && curOut) out.push({ icon: catMeta(cats[0][0]).icon, tone: 'info', html: `<b>${esc(cats[0][0])}</b> é sua maior despesa do mês: ${money(cats[0][1])} (${Math.round((cats[0][1] / curOut) * 100)}% do total).` });
    const soon = S.subs.map((s) => ({ s, d: daysUntil(s.day) })).filter((x) => x.d <= 5).sort((a, b) => a.d - b.d)[0];
    if (soon) out.push({ icon: 'repeat', tone: 'amber', html: `<b>${esc(soon.s.name)}</b> ${soon.d === 0 ? 'cobra hoje' : `cobra em ${plural(soon.d, 'dia', 'dias')}`} (${money(soon.s.amount)}).` });
    const ready = activeWishes().filter((w) => w.saved >= w.price);
    const near = activeWishes().filter((w) => w.saved < w.price && w.saved / w.price >= 0.8).sort((a, b) => (a.price - a.saved) - (b.price - b.saved))[0];
    if (ready.length) out.push({ icon: 'gift', tone: 'in', html: `<b>${esc(ready[0].name)}</b> está pronto para comprar: você já juntou o valor.` });
    else if (near) out.push({ icon: 'gift', tone: 'accent', html: `Faltam só <b>${money(near.price - near.saved)}</b> para ${esc(near.name)}.` });
    const overdue = S.tasks.filter((t) => !t.done && t.due && t.due < today()).length;
    if (overdue) out.push({ icon: 'alert', tone: 'out', html: `Você tem <b>${plural(overdue, 'tarefa atrasada', 'tarefas atrasadas')}</b>.` });
    const top = S.habits.map((h) => ({ h, s: streak(h) })).sort((a, b) => b.s - a.s)[0];
    if (top && top.s >= 3) out.push({ icon: 'flame', tone: 'amber', html: `<b>${esc(top.h.name)}</b>: ${top.s} dias seguidos${top.s >= bestStreak(top.h) ? ', seu recorde' : ''}. Continue assim!` });
    return out.slice(0, 4);
  }

  function viewHome() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const t = totals(monthTx(y, m));
    const budget = Number(S.settings.budget) || 0;
    const pct = budget ? t.out / budget : 0;

    const hero = `<section class="card hero span-2">
      <div class="hero-top"><span class="eyebrow">Saldo de ${monthName(y, m)}</span><button type="button" class="chip-btn" data-go="finance">Ver detalhes ${ic('right', 'sm')}</button></div>
      <div class="big">${money(t.bal)}</div>
      <div class="hero-split">
        <div><span class="lbl">${ic('in', 'sm')}Entradas</span><b>${money(t.inc)}</b></div>
        <div><span class="lbl">${ic('out', 'sm')}Saídas</span><b>${money(t.out)}</b></div>
      </div>
      ${budget ? `<div><div class="budget-line"><span>Orçamento do mês</span><span class="num">${Math.round(pct * 100)}% de ${money(budget)}</span></div><div class="bar ${pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : ''}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div></div>`
        : `<button type="button" class="link" data-act="budget">${ic('plus', 'sm')}Definir orçamento do mês</button>`}
    </section>`;

    const ask = `<button type="button" class="ask-bar span-2" data-go="chat"><svg class="mark" aria-hidden="true"><use href="#i-zeny"/></svg><span>Conte ao Zeny: "gastei 30 no almoço"</span>${ic('mic')}</button>`;

    const due = S.tasks.filter((x) => !x.done && x.due && x.due <= today()).sort(sortTasks);
    const upcoming = S.tasks.filter((x) => !x.done && (!x.due || x.due > today())).sort(sortTasks).slice(0, Math.max(0, 4 - due.length));
    const tasksCard = `<section class="card">
      <header class="card-head"><h2>Para hoje</h2><button type="button" class="link" data-go="tasks">Todas ${ic('right', 'sm')}</button></header>
      ${due.length || upcoming.length ? `<div class="rows">${due.map(taskRow).join('')}${upcoming.length ? `<div class="group-label">Próximas</div>${upcoming.map(taskRow).join('')}` : ''}</div>`
        : emptyState('tasks', 'Nada pendente', 'Diga ao Zeny: "me lembra de pagar o boleto sexta".', `<button type="button" class="btn sm ghost" data-act="new-task">${ic('plus', 'sm')}Nova tarefa</button>`)}
    </section>`;

    const doneToday = S.habits.filter((h) => h.days[today()]).length;
    const habitsCard = `<section class="card">
      <header class="card-head"><div><h2>Hábitos de hoje</h2><span class="sub">${S.habits.length ? (doneToday === S.habits.length ? 'Tudo feito hoje!' : `Faltam ${S.habits.length - doneToday}`) : 'Crie o primeiro'}</span></div>${S.habits.length ? ring(doneToday, S.habits.length) : ''}</header>
      ${S.habits.length ? `<div class="habit-chips">${S.habits.map((h) => `<button type="button" class="habit-chip ${h.days[today()] ? 'on' : ''}" data-act="habit-today" data-id="${h.id}" aria-pressed="${!!h.days[today()]}"><span class="dot">${ic('check')}</span>${esc(h.name)}</button>`).join('')}</div>`
        : emptyState('flame', 'Nenhum hábito ainda', 'Pequenas rotinas, todo dia.', `<button type="button" class="btn sm ghost" data-act="new-habit">${ic('plus', 'sm')}Novo hábito</button>`)}
    </section>`;

    const ins = insights();
    const insightsCard = `<section class="card">
      <header class="card-head"><h2>Insights do Zeny</h2>${ic('sparkles')}</header>
      ${ins.length ? `<div class="insights">${ins.map((i) => `<div class="insight"><span class="i-ic tone-${i.tone}">${ic(i.icon)}</span><span>${i.html}</span></div>`).join('')}</div>`
        : '<p class="muted small">Os insights aparecem conforme você registra gastos, tarefas e hábitos.</p>'}
    </section>`;

    const quick = `<section class="card">
      <header class="card-head"><h2>Atalhos</h2></header>
      <div class="quick">
        <button type="button" data-act="new-out"><span class="q-ic tone-out">${ic('out')}</span>Gasto</button>
        <button type="button" data-act="new-in"><span class="q-ic tone-in">${ic('in')}</span>Entrada</button>
        <button type="button" data-act="new-task"><span class="q-ic tone-info">${ic('tasks')}</span>Tarefa</button>
        <button type="button" data-act="new-habit"><span class="q-ic tone-amber">${ic('flame')}</span>Hábito</button>
        <button type="button" data-act="new-wish"><span class="q-ic tone-accent">${ic('gift')}</span>Quero comprar</button>
        <button type="button" data-act="new-goal"><span class="q-ic tone-accent">${ic('target')}</span>Meta</button>
        <button type="button" data-act="new-sub"><span class="q-ic tone-info">${ic('repeat')}</span>Assinatura</button>
      </div>
    </section>`;

    const recent = [...S.tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const recentCard = `<section class="card">
      <header class="card-head"><h2>Últimos lançamentos</h2><button type="button" class="link" data-go="finance">Ver todos ${ic('right', 'sm')}</button></header>
      ${recent.length ? `<div class="rows">${recent.map(txRow).join('')}</div>` : emptyState('wallet', 'Sem lançamentos', 'Conte um gasto ao Zeny ou use os atalhos.')}
    </section>`;

    const wl = activeWishes().sort((a, b) => b.saved / b.price - a.saved / a.price).slice(0, 3);
    const wishCard = `<section class="card">
      <header class="card-head"><h2>Quero comprar</h2><button type="button" class="link" data-go="wishes">${S.wishes.length ? 'Ver lista' : 'Abrir'} ${ic('right', 'sm')}</button></header>
      ${wl.length ? `<div class="rows">${wl.map(wishRow).join('')}</div>`
        : emptyState('gift', 'Nada na lista ainda', 'Diga ao Zeny: "quero comprar uma bicicleta de 1500". Eu aviso quando você juntar o valor.', `<button type="button" class="btn sm ghost" data-act="new-wish">${ic('plus', 'sm')}Adicionar desejo</button>`)}
    </section>`;
    const goalsCard = S.goals.length ? `<section class="card">
      <header class="card-head"><h2>Metas</h2><button type="button" class="link" data-act="new-goal">${ic('plus', 'sm')}Nova</button></header>
      <div class="rows">${S.goals.map(goalRow).join('')}</div>
    </section>` : '';

    return `${demoBanner()}<div class="grid two">${ask}${hero}${tasksCard}${habitsCard}${wishCard}${insightsCard}${quick}${recentCard}${goalsCard}</div>`;
  }

  // ---------- Tela: Finanças ----------
  let viewMonth = new Date(); viewMonth.setDate(1);
  let scope = 'all';
  let txQuery = '';

  function niceMax(v) {
    if (!v || v <= 0) return 100;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
    return 10 * p;
  }
  function barChart(y, m) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - i, 1);
      const tt = totals(monthTx(d.getFullYear(), d.getMonth(), scope));
      months.push({ label: shortMonth(d), inc: tt.inc, out: tt.out, cur: i === 0 });
    }
    const max = niceMax(Math.max(...months.map((x) => Math.max(x.inc, x.out))));
    const W = 340, H = 190, pl = 44, pr = 6, pt = 10, pb = 26;
    const iw = W - pl - pr, ih = H - pt - pb, gw = iw / months.length, bw = Math.min(14, gw * 0.3);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 6 meses">`;
    for (const f of [0, 0.5, 1]) {
      const yy = (pt + ih - ih * f).toFixed(1);
      s += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pl - 6}" y="${(Number(yy) + 3).toFixed(1)}" text-anchor="end">${compact(max * f)}</text>`;
    }
    months.forEach((mo, i) => {
      const cx = pl + gw * i + gw / 2;
      const hi = (ih * mo.inc) / max, ho = (ih * mo.out) / max;
      if (hi > 0) s += `<rect class="b-in" x="${(cx - bw - 1.5).toFixed(1)}" y="${(pt + ih - hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}" rx="3"><title>Entradas: ${money(mo.inc)}</title></rect>`;
      if (ho > 0) s += `<rect class="b-out" x="${(cx + 1.5).toFixed(1)}" y="${(pt + ih - ho).toFixed(1)}" width="${bw.toFixed(1)}" height="${ho.toFixed(1)}" rx="3"><title>Saídas: ${money(mo.out)}</title></rect>`;
      s += `<text class="axis ${mo.cur ? 'cur' : ''}" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(mo.label)}</text>`;
    });
    return s + '</svg>';
  }
  function donut(list) {
    const cats = byCat(list);
    const total = cats.reduce((a, [, v]) => a + v, 0);
    if (!total) return emptyState('wallet', 'Sem gastos neste mês', 'Quando você registrar gastos, eles aparecem aqui por categoria.');
    const top = cats.slice(0, 5);
    const rest = cats.slice(5).reduce((a, [, v]) => a + v, 0);
    if (rest) top.push(['Outros', rest]);
    const r = 52, c = 2 * Math.PI * r;
    let off = 0, segs = '';
    for (const [name, v] of top) {
      const len = (v / total) * c;
      const vis = top.length > 1 ? Math.max(0.5, len - 2) : len;
      segs += `<circle cx="70" cy="70" r="${r}" stroke="${catMeta(name).color}" stroke-dasharray="${vis.toFixed(2)} ${(c - vis).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(name)}: ${money(v)}</title></circle>`;
      off += len;
    }
    return `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Gastos por categoria"><circle class="track" cx="70" cy="70" r="${r}"/>${segs}<text class="d-lbl" x="70" y="64">Total</text><text class="d-val" x="70" y="82">${esc(moneyShort(total))}</text></svg>
      <ul class="legend">${top.map(([name, v]) => `<li><i style="background:${catMeta(name).color}"></i><span class="name">${esc(name)}</span><span class="v">${money(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span></li>`).join('')}</ul>
    </div>`;
  }
  function goalRow(g) {
    const p = g.target ? Math.min(100, (g.saved / g.target) * 100) : 0;
    return `<button type="button" class="goal" data-act="goal-edit" data-id="${g.id}">
      <span class="top"><span>${esc(g.name)}</span><span class="num">${Math.round(p)}%</span></span>
      <span class="bar"><i style="width:${p.toFixed(1)}%"></i></span>
      <span class="small muted num">${money(g.saved)} de ${money(g.target)}</span>
    </button>`;
  }
  function subRow(s) {
    const d = daysUntil(s.day);
    return `<button type="button" class="row" data-act="sub-edit" data-id="${s.id}">
      ${catIcon(s.cat || 'Assinaturas')}
      <span class="grow"><span class="title">${esc(s.name)}</span><span class="meta">Todo dia ${s.day} · ${d === 0 ? 'cobra hoje' : `em ${plural(d, 'dia', 'dias')}`}${s.autoPost !== false && allowed('autoSubs') ? ` · <span class="pill">${ic('repeat')}Automático</span>` : ''}</span></span>
      <span class="amount">${money(s.amount)}</span>
    </button>`;
  }
  function txRowsHtml() {
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    const q = norm(txQuery.trim());
    const list = monthTx(y, m, scope).filter((x) => !q || norm(x.desc + ' ' + x.cat).includes(q)).sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) return q ? emptyState('search', 'Nada encontrado', `Nenhum lançamento com "${esc(txQuery)}".`) : emptyState('wallet', 'Nenhum lançamento', 'Conte ao Zeny: "gastei 20 no lanche".');
    const groups = {};
    for (const x of list) (groups[x.date] ||= []).push(x);
    return Object.entries(groups).map(([d, items]) => {
      const net = totals(items).bal;
      return `<div class="group-label"><span>${esc(dayLabel(d))}</span><span class="num ${net >= 0 ? 'pos' : ''}">${net >= 0 ? '+' : '−'} ${money(Math.abs(net))}</span></div><div class="rows">${items.map(txRow).join('')}</div>`;
    }).join('');
  }
  function viewFinance() {
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    const list = monthTx(y, m, scope);
    const t = totals(list);
    const isCur = monthKey(viewMonth) === monthKey(new Date());
    const budget = Number(S.settings.budget) || 0;
    const pct = budget ? t.out / budget : 0;
    const bizLocked = !allowed('business');
    const subTotal = S.subs.reduce((a, s) => a + s.amount, 0);

    return `${demoBanner()}
    <div class="toolbar">
      <div class="month-nav">
        <button type="button" class="icon-btn" data-act="month-prev" aria-label="Mês anterior">${ic('left')}</button>
        <strong>${esc(cap(viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })))}</strong>
        <button type="button" class="icon-btn" data-act="month-next" aria-label="Próximo mês">${ic('right')}</button>
      </div>
      <div class="seg" role="group" aria-label="Conta">
        ${[['all', 'Tudo'], ['pessoal', 'Pessoal'], ['empresa', 'Empresa']].map(([k, l]) => `<button type="button" class="${scope === k ? 'on' : ''}" data-act="scope" data-id="${k}">${l}${k === 'empresa' && bizLocked ? ' ' + ic('lock', 'sm') : ''}</button>`).join('')}
      </div>
    </div>
    <div class="grid">
      <div class="stats">
        <div class="stat"><span class="lbl">${ic('in', 'sm')}Entradas</span><b class="pos">${money(t.inc)}</b></div>
        <div class="stat"><span class="lbl">${ic('out', 'sm')}Saídas</span><b class="neg">${money(t.out)}</b></div>
        <div class="stat bal"><span class="lbl">${ic('wallet', 'sm')}Saldo</span><b class="${t.bal < 0 ? 'neg' : ''}">${money(t.bal)}</b></div>
      </div>
      ${isCur && budget ? `<section class="card"><div class="card-head"><h2>Orçamento do mês</h2><button type="button" class="link" data-act="budget">${ic('edit', 'sm')}Alterar</button></div><div class="bar ${pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : ''}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div><p class="small muted" style="margin-top:8px">${money(t.out)} de ${money(budget)} · ${pct >= 1 ? `passou ${money(t.out - budget)}` : `restam ${money(budget - t.out)}`}</p></section>` : ''}
      <div class="grid two">
        <section class="card">
          <header class="card-head"><h2>Últimos 6 meses</h2><div class="legend-inline"><span><i style="background:var(--in)"></i>Entradas</span><span><i style="background:var(--out)"></i>Saídas</span></div></header>
          ${barChart(y, m)}
        </section>
        <section class="card">
          <header class="card-head"><h2>Gastos por categoria</h2></header>
          ${donut(list)}
        </section>
        <section class="card">
          <header class="card-head"><h2>Metas de economia</h2><button type="button" class="link" data-act="new-goal">${ic('plus', 'sm')}Nova</button></header>
          ${S.goals.length ? `<div class="rows">${S.goals.map(goalRow).join('')}</div>` : emptyState('target', 'Nenhuma meta', 'Ex.: "meta de juntar 3000 para viagem".')}
        </section>
        <section class="card">
          <header class="card-head"><div><h2>Assinaturas</h2>${S.subs.length ? `<span class="sub num">${money(subTotal)} por mês</span>` : ''}</div><button type="button" class="link" data-act="new-sub">${ic('plus', 'sm')}Nova</button></header>
          ${S.subs.length ? `<div class="rows">${[...S.subs].sort((a, b) => daysUntil(a.day) - daysUntil(b.day)).map(subRow).join('')}</div>` : emptyState('repeat', 'Nenhuma assinatura', 'Ex.: "assinatura Spotify 21,90 dia 5".')}
        </section>
      </div>
      <section class="card">
        <header class="card-head" style="flex-wrap:wrap"><h2>Lançamentos</h2>
          <div class="head-actions" style="flex:1;justify-content:flex-end">
            <label class="search"><span class="sr-only">Buscar lançamentos</span>${ic('search')}<input id="txSearch" type="search" placeholder="Buscar" value="${esc(txQuery)}"></label>
            <button type="button" class="btn sm primary" data-act="new-out">${ic('plus', 'sm')}Novo</button>
          </div>
        </header>
        <div id="txRows">${txRowsHtml()}</div>
      </section>
    </div>`;
  }

  // ---------- Tela: Hábitos ----------
  const expanded = new Set();
  const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  function habitCard(h) {
    const on = !!h.days[today()];
    const st = streak(h), best = bestStreak(h);
    const now = new Date();
    let week = '';
    for (let i = 6; i >= 0; i--) {
      const d = addDays(now, -i);
      const k = ymd(d);
      week += `<button type="button" class="${h.days[k] ? 'on' : ''} ${i === 0 ? 'today' : ''}" data-act="habit-day" data-id="${h.id}" data-day="${k}" aria-pressed="${!!h.days[k]}" aria-label="${esc(dayLabel(k))}">${WD[d.getDay()]}<span class="d">${d.getDate()}</span></button>`;
    }
    const y = now.getFullYear(), m = now.getMonth(), dim = daysInMonth(y, m);
    const monthCount = Object.keys(h.days).filter((k) => h.days[k] && k.startsWith(monthKey(now))).length;
    let month = '';
    if (expanded.has(h.id)) {
      month = '<div class="month-grid">' + WD.map((d) => `<span class="wd">${d}</span>`).join('');
      for (let i = 0; i < new Date(y, m, 1).getDay(); i++) month += '<span class="md blank"></span>';
      for (let d = 1; d <= dim; d++) {
        const k = ymd(new Date(y, m, d));
        month += `<button type="button" class="md ${h.days[k] ? 'on' : ''}" data-act="habit-day" data-id="${h.id}" data-day="${k}" ${k > today() ? 'disabled' : ''}>${d}</button>`;
      }
      month += '</div>';
    }
    return `<section class="card habit-card">
      <div class="habit-head">
        <span class="h-ic ${on ? 'on' : ''}">${ic('flame')}</span>
        <div class="grow"><div class="name">${esc(h.name)}</div><div class="streak">${st ? `<b>${plural(st, 'dia seguido', 'dias seguidos')}</b>` : 'Comece hoje'}</div></div>
        <button type="button" class="big-check ${on ? 'on' : ''}" data-act="habit-today" data-id="${h.id}" aria-pressed="${on}">${ic('check', 'sm')}${on ? 'Feito' : 'Marcar'}</button>
      </div>
      <div class="week">${week}</div>
      ${month}
      <div class="habit-foot"><span>Recorde: ${plural(best, 'dia', 'dias')} · ${monthCount} de ${dim} em ${monthName(y, m)}</span><span class="head-actions"><button type="button" class="link" data-act="habit-edit" data-id="${h.id}">${ic('edit', 'sm')}Editar</button><button type="button" class="link" data-act="habit-month" data-id="${h.id}">${expanded.has(h.id) ? 'Ocultar mês' : 'Ver mês'}</button></span></div>
    </section>`;
  }
  function viewHabits() {
    if (!S.habits.length) {
      return `${demoBanner()}<section class="card">${emptyState('flame', 'Crie seu primeiro hábito', 'Diga ao Zeny "criar hábito beber 2L de água" ou use o botão abaixo.', `<button type="button" class="btn primary" data-act="new-habit">${ic('plus', 'sm')}Novo hábito</button>`)}</section>`;
    }
    const done = S.habits.filter((h) => h.days[today()]).length;
    const top = S.habits.map((h) => ({ h, s: streak(h) })).sort((a, b) => b.s - a.s)[0];
    return `${demoBanner()}<div class="grid">
      <section class="card" style="display:flex;align-items:center;gap:16px">
        ${ring(done, S.habits.length)}
        <div><strong style="font-size:17px">${done === S.habits.length ? 'Tudo feito hoje. Parabéns!' : `${done} de ${S.habits.length} hábitos feitos hoje`}</strong>
        <p class="muted small">${top && top.s ? `Maior sequência atual: ${esc(top.h.name)}, ${plural(top.s, 'dia', 'dias')}.` : 'Marque o que fizer para começar suas sequências.'}</p></div>
      </section>
      <div class="grid two">${S.habits.map(habitCard).join('')}</div>
    </div>`;
  }

  // ---------- Tela: Tarefas ----------
  let taskFilter = 'open';
  function viewTasks() {
    const open = S.tasks.filter((t) => !t.done).sort(sortTasks);
    const done = S.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    const seg = `<div class="toolbar"><div class="seg" role="group" aria-label="Filtro">
      <button type="button" class="${taskFilter === 'open' ? 'on' : ''}" data-act="task-filter" data-id="open">Pendentes · ${open.length}</button>
      <button type="button" class="${taskFilter === 'done' ? 'on' : ''}" data-act="task-filter" data-id="done">Concluídas · ${done.length}</button>
    </div>${taskFilter === 'done' && done.length ? `<button type="button" class="btn sm ghost" data-act="clear-done">${ic('trash', 'sm')}Limpar concluídas</button>` : ''}</div>`;
    let body;
    if (taskFilter === 'done') {
      body = done.length ? `<div class="rows">${done.map(taskRow).join('')}</div>` : emptyState('tasks', 'Nenhuma tarefa concluída', 'As tarefas que você terminar aparecem aqui.');
    } else if (!open.length) {
      body = emptyState('check', 'Tudo em dia!', 'Diga ao Zeny: "me lembra de pagar o boleto sexta".', `<button type="button" class="btn sm primary" data-act="new-task">${ic('plus', 'sm')}Nova tarefa</button>`);
    } else {
      const td = today(), tm = ymd(addDays(new Date(), 1)), wk = ymd(addDays(new Date(), 7));
      const groups = [
        ['Atrasadas', open.filter((t) => t.due && t.due < td), true],
        ['Hoje', open.filter((t) => t.due === td)],
        ['Amanhã', open.filter((t) => t.due === tm)],
        ['Próximos 7 dias', open.filter((t) => t.due > tm && t.due <= wk)],
        ['Mais para frente', open.filter((t) => t.due > wk)],
        ['Sem data', open.filter((t) => !t.due)],
      ];
      body = groups.filter(([, l]) => l.length).map(([label, l, alert]) => `<div class="group-label ${alert ? 'alert' : ''}"><span>${label}</span><span>${l.length}</span></div><div class="rows">${l.map(taskRow).join('')}</div>`).join('');
    }
    return `${demoBanner()}${seg}<section class="card">${body}</section>`;
  }

  // ---------- Tela: Quero comprar ----------
  function wishRow(w) {
    const p = w.price ? Math.min(100, (w.saved / w.price) * 100) : 0;
    const ready = w.saved >= w.price;
    return `<button type="button" class="goal" data-act="${ready ? 'wish-buy' : 'wish-save'}" data-id="${w.id}">
      <span class="top"><span>${esc(w.name)}</span>${ready ? `<span class="pill tone-in">${ic('check')}Pronto para comprar</span>` : `<span class="num">${Math.round(p)}%</span>`}</span>
      <span class="bar ${ready ? 'done' : ''}"><i style="width:${p.toFixed(1)}%"></i></span>
      <span class="small muted num">${money(w.saved)} de ${money(w.price)}${ready ? '' : ` · faltam ${money(w.price - w.saved)}`}</span>
    </button>`;
  }
  function wishCard(w) {
    const p = w.price ? Math.min(100, (w.saved / w.price) * 100) : 0;
    const ready = w.saved >= w.price;
    const pace = wishPace(w);
    return `<section class="card wish ${ready ? 'ready' : ''}">
      <div class="wish-head">
        <span class="w-ic">${ic('gift')}</span>
        <div class="grow"><div class="name">${esc(w.name)}</div><div class="small muted num">${money(w.saved)} de ${money(w.price)}</div></div>
        ${ready ? `<span class="pill tone-in">${ic('check')}Pronto</span>` : `<span class="pct num">${Math.round(p)}%</span>`}
      </div>
      <div class="bar ${ready ? 'done' : ''}"><i style="width:${p.toFixed(1)}%"></i></div>
      <p class="small ${ready ? 'pos' : 'muted'}">${ready ? `Você já juntou o valor desde ${esc(fmtDate(w.reachedAt || today()))}. Pode comprar!` : `Faltam <b>${money(w.price - w.saved)}</b>${pace ? ` · ${esc(pace)}` : ''}`}</p>
      <div class="wish-actions">
        ${ready ? `<button type="button" class="btn sm primary" data-act="wish-buy" data-id="${w.id}">${ic('check', 'sm')}Já comprei</button>` : `<button type="button" class="btn sm primary" data-act="wish-save" data-id="${w.id}">${ic('plus', 'sm')}Guardar</button>`}
        <button type="button" class="btn sm ghost" data-act="wish-edit" data-id="${w.id}">${ic('edit', 'sm')}Editar</button>
        ${w.link ? `<a class="btn sm ghost" href="${esc(w.link)}" target="_blank" rel="noopener">Ver produto ${ic('right', 'sm')}</a>` : ''}
      </div>
    </section>`;
  }
  function viewWishes() {
    const list = activeWishes().sort((a, b) => (b.saved >= b.price) - (a.saved >= a.price) || b.saved / b.price - a.saved / a.price);
    const bought = S.wishes.filter((w) => w.bought).sort((a, b) => (b.boughtAt || '').localeCompare(a.boughtAt || ''));
    const total = list.reduce((a, w) => a + w.price, 0);
    const saved = list.reduce((a, w) => a + Math.min(w.saved, w.price), 0);
    const ready = list.filter((w) => w.saved >= w.price).length;
    const notifLine = notifStatus === 'granted' && S.settings.notify !== false
      ? `<span class="pill tone-in">${ic('bell')}Avisos ativados</span>`
      : notifStatus === 'default' ? `<button type="button" class="btn sm ghost" data-act="notif-enable">${ic('bell', 'sm')}Ativar avisos no celular</button>`
      : `<span class="small muted">${ic('bell', 'sm')} O aviso aparece aqui no app quando você atingir o valor.</span>`;
    return `${demoBanner()}<div class="grid">
      <div class="stats">
        <div class="stat bal"><span class="lbl">${ic('gift', 'sm')}Na lista</span><b>${money(total)}</b></div>
        <div class="stat"><span class="lbl">${ic('wallet', 'sm')}Guardado</span><b class="pos">${money(saved)}</b></div>
        <div class="stat"><span class="lbl">${ic('check', 'sm')}Prontos</span><b>${ready} de ${list.length}</b></div>
      </div>
      <div class="notif-line">${notifLine}</div>
      ${list.length ? `<div class="grid two">${list.map(wishCard).join('')}</div>`
        : `<section class="card">${emptyState('gift', 'O que você quer comprar?', 'Adicione um item com o preço e vá guardando aos poucos. Quando juntar o valor, o Zeny te avisa.', `<button type="button" class="btn primary" data-act="new-wish">${ic('plus', 'sm')}Adicionar desejo</button>`)}</section>`}
      ${bought.length ? `<section class="card"><header class="card-head"><h2>Já comprados</h2><span class="sub">${bought.length}</span></header><div class="rows">${bought.map((w) => `<button type="button" class="row done" data-act="wish-edit" data-id="${w.id}"><span class="cat-ic tone-in">${ic('check')}</span><span class="grow"><span class="title">${esc(w.name)}</span><span class="meta">Comprado ${esc(fmtDate(w.boughtAt))}</span></span><span class="amount">${money(w.paid || w.price)}</span></button>`).join('')}</div></section>` : ''}
    </div>`;
  }

  // ---------- Tela: Planos ----------
  function priceBlock(p, billing) {
    const monthly = Number.isFinite(p.monthly) ? p.monthly : null;
    const annual = Number.isFinite(p.annual) ? p.annual : null;
    if (billing === 'annual') {
      if (annual == null) return { price: '<span class="soon">Valor em breve</span>', note: 'Plano anual' };
      const save = monthly ? Math.round((1 - annual / (monthly * 12)) * 100) : 0;
      return {
        price: `<span class="cur">${money(annual / 12)}</span><span class="per">/mês</span>`,
        note: `${money(annual)} cobrado por ano${save > 0 ? ` · <strong class="pos">economize ${save}%</strong>` : ''}`,
      };
    }
    if (monthly == null) return { price: '<span class="soon">Valor em breve</span>', note: 'Plano mensal' };
    return { price: `<span class="cur">${money(monthly)}</span><span class="per">/mês</span>`, note: 'Cobrado todo mês' };
  }
  function maxAnnualSaving() {
    let best = 0;
    for (const p of PLANS) if (Number.isFinite(p.monthly) && Number.isFinite(p.annual) && p.monthly > 0) best = Math.max(best, Math.round((1 - p.annual / (p.monthly * 12)) * 100));
    return best;
  }
  function usageCard() {
    const limit = limitOf('aiMessages');
    const used = S.usage.month === monthKey(new Date()) ? S.usage.ai : 0;
    const p = limit ? Math.min(1, used / limit) : 0;
    return `<section class="card" style="margin-bottom:20px">
      <div class="card-head"><div><span class="eyebrow">Seu plano</span><h2 style="margin-top:4px">${esc(currentPlan().name)}</h2></div><span class="pill tone-accent">${ic('crown')}${ENFORCE ? 'Ativo' : 'Modo de teste'}</span></div>
      <div class="usage">
        <div class="top"><span>Mensagens com a IA este mês</span><span class="num">${limit == null ? `${used} · sem limite` : `${used} de ${limit}`}</span></div>
        ${limit == null ? '' : `<div class="bar ${p >= 1 ? 'over' : p >= 0.8 ? 'warn' : ''}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`}
        ${ENFORCE ? '' : '<p class="small muted">Os limites ainda não estão sendo aplicados. Tudo está liberado enquanto as assinaturas não abrem.</p>'}
      </div>
    </section>`;
  }
  function viewPlans() {
    // Sem preços anuais definidos, mostra só a cobrança mensal.
    const hasAnnual = PLANS.some((p) => Number.isFinite(p.annual));
    const billing = !hasAnnual || S.settings.billing === 'monthly' ? 'monthly' : 'annual';
    const saving = maxAnnualSaving();
    const trial = Number(PLAN_CFG.trialDays) || 0;
    const cards = PLANS.map((p) => {
      const { price, note } = priceBlock(p, billing);
      const isCurrent = p.id === currentPlan().id && ENFORCE;
      const link = p.checkout && p.checkout[billing];
      const cta = isCurrent
        ? `<div class="current">${ic('check', 'sm')}Seu plano atual</div>`
        : link
          ? `<a class="btn ${p.highlight ? 'primary' : 'ghost'} block" href="${esc(link)}" target="_blank" rel="noopener">${trial ? `Testar ${trial} dias grátis` : `Assinar ${esc(p.name)}`}</a>`
          : `<button type="button" class="btn ${p.highlight ? 'primary' : 'ghost'} block" data-act="plan-choose" data-id="${esc(p.id)}">${trial ? `Testar ${trial} dias grátis` : `Quero o ${esc(p.name)}`}</button>`;
      return `<article class="plan ${p.highlight ? 'highlight' : ''}">
        ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        <div><h3>${esc(p.name)}</h3><p class="tagline">${esc(p.tagline || '')}</p></div>
        <div><div class="price">${price}</div><p class="price-note">${note}</p></div>
        <ul>${(p.features || []).map((f) => `<li>${ic('check')}<span>${esc(f)}</span></li>`).join('')}</ul>
        ${cta}
      </article>`;
    }).join('');
    const faq = [
      ...(hasAnnual ? [['Qual a diferença entre o mensal e o anual?', 'No mensal você paga todo mês. No anual você paga uma vez por ano, e o valor por mês fica menor.']] : []),
      ['O que conta como mensagem com a IA?', 'Cada mensagem que o Zeny responde usando a inteligência artificial. Comandos simples, como "gastei 30 no almoço", também funcionam no modo local.'],
      ['Onde ficam meus dados?', 'No seu aparelho. Só as mensagens e um resumo dos seus números são enviados à IA para ela conseguir responder.'],
    ];
    return `${usageCard()}
      ${hasAnnual ? `<div class="billing">
        <div class="seg" role="group" aria-label="Forma de cobrança">
          <button type="button" class="${billing === 'monthly' ? 'on' : ''}" data-act="plan-billing" data-id="monthly">Mensal</button>
          <button type="button" class="${billing === 'annual' ? 'on' : ''}" data-act="plan-billing" data-id="annual">Anual</button>
        </div>
        <span class="save-tag">${saving > 0 ? `Economize até ${saving}% no anual` : 'Anual sai mais em conta'}</span>
      </div>` : '<div class="billing"><span class="small muted">Valores por mês, cobrados mensalmente.</span></div>'}
      <div class="plans">${cards}</div>
      <section class="card" style="margin-top:20px">
        <header class="card-head"><h2>Perguntas frequentes</h2></header>
        <div class="rows">${faq.map(([q, a]) => `<details class="row" style="display:block"><summary class="title" style="cursor:pointer;white-space:normal">${q}</summary><p class="muted small" style="margin-top:6px">${a}</p></details>`).join('')}</div>
        ${CFG.supportEmail ? `<p class="small muted" style="margin-top:12px">Dúvidas? Escreva para <strong>${esc(CFG.supportEmail)}</strong></p>` : ''}
      </section>`;
  }

  // ---------- Tela: Ajustes ----------
  function viewSettings() {
    const mode = aiMode();
    const th = S.settings.theme;
    const limitedExport = !allowed('export');
    return `<div class="settings">
      <section class="card">
        <header class="card-head"><h2>Perfil</h2></header>
        <div class="set-row"><div class="grow"><div class="title">Seu nome</div><div class="desc">Como o Zeny te chama nas mensagens.</div></div><input type="text" id="setName" data-set="userName" value="${esc(S.settings.userName)}" placeholder="Seu nome" maxlength="40"></div>
        <div class="set-row"><div class="grow"><div class="title">Plano</div><div class="desc">${esc(currentPlan().name)}${ENFORCE ? '' : ' · modo de teste'}</div></div><button type="button" class="btn sm ghost" data-go="plans">${ic('crown', 'sm')}Ver planos</button></div>
      </section>
      <section class="card">
        <header class="card-head"><h2>Aparência</h2></header>
        <div class="set-row"><div class="grow"><div class="title">Tema</div><div class="desc">Sistema segue a configuração do seu aparelho.</div></div>
          <div class="seg" role="group" aria-label="Tema">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<button type="button" class="${th === k ? 'on' : ''}" data-act="theme" data-id="${k}">${l}</button>`).join('')}</div></div>
      </section>
      <section class="card">
        <header class="card-head"><h2>Finanças</h2></header>
        <div class="set-row"><div class="grow"><div class="title">Orçamento mensal</div><div class="desc">Limite de gastos do mês. O Zeny avisa quando estiver perto.</div></div><input type="number" id="setBudget" data-set="budget" inputmode="decimal" min="0" step="50" value="${Number(S.settings.budget) || ''}" placeholder="R$ 0,00"></div>
      </section>
      <section class="card">
        <header class="card-head"><h2>Assistente</h2></header>
        <div class="ai-status ${mode !== 'local' ? 'on' : ''}"><span class="dot"></span><div><div class="title">${AI_LABEL[mode]}</div><div class="desc small muted">${mode === 'claude' ? 'Respostas pelo Claude, usando a sua conta do claude.ai.' : mode === 'server' ? 'Respostas pelo servidor do Zeny.' : 'Entende comandos comuns em português, direto no aparelho.'}</div></div></div>
        <div class="set-row"><div class="grow"><div class="title">Personalidade</div><div class="desc">${S.settings.persona === 'genio' ? 'Gênio: confiante, rápido e espirituoso. Te chama de "chefe".' : 'Simpático, claro e direto.'}</div></div>
          <div class="seg" role="group" aria-label="Personalidade">${[['padrao', 'Padrão'], ['genio', 'Gênio']].map(([k, l]) => `<button type="button" class="${(S.settings.persona || 'padrao') === k ? 'on' : ''}" data-act="persona" data-id="${k}">${l}</button>`).join('')}</div></div>
        <div class="set-row"><div class="grow"><div class="title">Responder em voz alta</div><div class="desc">O Zeny lê as respostas.</div></div><button type="button" class="switch ${S.settings.speak ? 'on' : ''}" data-act="speak" role="switch" aria-checked="${!!S.settings.speak}" aria-label="Responder em voz alta"></button></div>
        <div class="set-row"><div class="grow"><div class="title">Estilo da voz</div><div class="desc">Confiante deixa a voz mais grave e firme.</div></div>
          <div class="seg" role="group" aria-label="Estilo da voz">${[['padrao', 'Padrão'], ['confiante', 'Confiante'], ['calma', 'Calma']].map(([k, l]) => `<button type="button" class="${(S.settings.voiceStyle || 'padrao') === k ? 'on' : ''}" data-act="voice-style" data-id="${k}">${l}</button>`).join('')}</div></div>
        ${ptVoices().length > 1 ? `<div class="set-row"><div class="grow"><div class="title">Voz</div><div class="desc">Vozes em português instaladas neste aparelho.</div></div>
          <select id="setVoice" data-set="voiceURI" class="voice-select"><option value="">Automática</option>${ptVoices().map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === S.settings.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>` : ''}
        <div class="set-row"><div class="grow"><div class="title">Ouvir exemplo</div><div class="desc">Teste a voz e a personalidade escolhidas.</div></div><button type="button" class="btn sm ghost" data-act="voice-test">${ic('volume', 'sm')}Ouvir</button></div>
        <div class="set-row"><div class="grow"><div class="title">Avisos de meta atingida</div><div class="desc">${notifStatus === 'granted' ? 'Você recebe uma notificação quando juntar o valor de um desejo ou meta.' : notifStatus === 'denied' ? 'Bloqueados. Libere as notificações nas configurações do navegador ou do celular.' : notifStatus === 'default' ? 'Receba uma notificação quando juntar o valor de um desejo ou meta.' : 'Aqui o aviso aparece dentro do app.'}</div></div>${notifStatus === 'granted' ? `<button type="button" class="switch ${S.settings.notify !== false ? 'on' : ''}" data-act="notif-toggle" role="switch" aria-checked="${S.settings.notify !== false}" aria-label="Avisos de meta atingida"></button>` : notifStatus === 'default' ? `<button type="button" class="btn sm ghost" data-act="notif-enable">${ic('bell', 'sm')}Ativar</button>` : ''}</div>
        <div class="set-row"><div class="grow"><div class="title">Servidor da IA</div><div class="desc">Opcional. Endereço do servidor que guarda a chave da API.</div></div><input type="url" id="setServer" data-set="serverUrl" value="${esc(S.settings.serverUrl || CFG.serverUrl || '')}" placeholder="https://…workers.dev"></div>
      </section>
      <section class="card">
        <header class="card-head"><h2>Dados</h2></header>
        <p class="small muted" style="margin-bottom:6px">Tudo fica salvo só neste aparelho.</p>
        <div class="set-row"><div class="grow"><div class="title">Exportar backup</div><div class="desc">${limitedExport ? `Disponível no plano ${esc(planWith('export')?.name || 'superior')}.` : 'Baixa um arquivo com todos os seus dados.'}</div></div><button type="button" class="btn sm ghost" data-act="export">${ic(limitedExport ? 'lock' : 'download', 'sm')}Exportar</button></div>
        <div class="set-row"><div class="grow"><div class="title">Importar backup</div><div class="desc">Substitui os dados atuais pelos do arquivo.</div></div><button type="button" class="btn sm ghost" data-act="import">${ic('upload', 'sm')}Importar</button></div>
        ${S.demo ? `<div class="set-row"><div class="grow"><div class="title">Dados de exemplo</div><div class="desc">Remove o exemplo e começa do zero.</div></div><button type="button" class="btn sm ghost" data-act="clear-demo">Limpar exemplo</button></div>` : ''}
        <div class="set-row"><div class="grow"><div class="title">Apagar tudo</div><div class="desc">Remove lançamentos, hábitos, tarefas e a conversa.</div></div><button type="button" class="btn sm danger" data-act="erase">${ic('trash', 'sm')}Apagar</button></div>
      </section>
      <p class="small muted" style="text-align:center">Zeny ${VERSION}${CFG.supportEmail ? ` · ${esc(CFG.supportEmail)}` : ''}</p>
    </div>`;
  }

  // ---------- Renderização ----------
  function headFor(view) {
    const mobileBtns = `<button type="button" class="icon-btn only-mobile" data-go="plans" aria-label="Planos">${ic('crown')}</button><button type="button" class="icon-btn only-mobile" data-go="settings" aria-label="Ajustes">${ic('settings')}</button>`;
    const name = S.settings.userName;
    const open = S.tasks.filter((t) => !t.done).length;
    const doneH = S.habits.filter((h) => h.days[today()]).length;
    switch (view) {
      case 'home': return { t: `${greeting()}${name ? ', ' + esc(name) : ''}`, s: esc(cap(longDate(new Date()))), a: mobileBtns };
      case 'finance': return { t: 'Finanças', s: 'Seu dinheiro, mês a mês', a: `<button type="button" class="btn primary sm" data-act="new-out">${ic('plus', 'sm')}<span class="hide-xs">Lançamento</span></button>${mobileBtns}` };
      case 'wishes': return { t: 'Quero comprar', s: 'Junte dinheiro para o que você quer. O Zeny avisa quando der.', a: `<button type="button" class="btn primary sm" data-act="new-wish">${ic('plus', 'sm')}<span class="hide-xs">Desejo</span></button>${mobileBtns}` };
      case 'habits': return { t: 'Hábitos', s: S.habits.length ? `${doneH} de ${S.habits.length} feitos hoje` : 'Construa sua rotina, um dia de cada vez', a: `<button type="button" class="btn primary sm" data-act="new-habit">${ic('plus', 'sm')}<span class="hide-xs">Hábito</span></button>${mobileBtns}` };
      case 'tasks': return { t: 'Tarefas', s: open ? plural(open, 'tarefa pendente', 'tarefas pendentes') : 'Nada pendente', a: `<button type="button" class="btn primary sm" data-act="new-task">${ic('plus', 'sm')}<span class="hide-xs">Tarefa</span></button>${mobileBtns}` };
      case 'plans': return { t: 'Planos', s: 'Escolha como o Zeny vai te acompanhar', a: `<button type="button" class="icon-btn only-mobile" data-go="home" aria-label="Voltar">${ic('left')}</button>` };
      case 'settings': return { t: 'Ajustes', s: 'Perfil, aparência, assistente e dados', a: `<button type="button" class="icon-btn only-mobile" data-go="home" aria-label="Voltar">${ic('left')}</button>` };
    }
    return { t: 'Zeny', s: '', a: '' };
  }
  const VIEW_FN = { home: viewHome, finance: viewFinance, wishes: viewWishes, habits: viewHabits, tasks: viewTasks, plans: viewPlans, settings: viewSettings };

  function renderMain() {
    try {
      const h = headFor(current);
      $('#pageHead').innerHTML = `<div><h1>${h.t}</h1><p>${h.s}</p></div><div class="head-actions">${h.a}</div>`;
      $('#view').innerHTML = VIEW_FN[current]();
    } catch (e) {
      console.error(e);
      $('#view').innerHTML = `<section class="card">${emptyState('alert', 'Algo deu errado nesta tela', 'Tente abrir outra aba. Seus dados continuam salvos.')}</section>`;
    }
    $$('[data-go]').forEach((b) => {
      const on = b.dataset.go === current;
      if (b.closest('.side-nav') || b.closest('.tabbar')) { b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    });
  }
  function renderSide() {
    const p = currentPlan();
    $('#sideFoot').innerHTML = `<div class="plan-card"><span class="eyebrow">Seu plano</span><strong>${esc(p.name)}</strong><span class="muted">${AI_LABEL[aiMode()]}</span><button type="button" class="btn sm ghost" data-go="plans">${ic('crown', 'sm')}Ver planos</button></div>`;
  }
  function renderAiStatus() {
    const mode = aiMode();
    const el = $('#chatStatus');
    el.textContent = AI_LABEL[mode];
    el.classList.toggle('ai', mode !== 'local');
    const sp = $('#speakToggle');
    sp.setAttribute('aria-pressed', String(!!S.settings.speak));
    sp.innerHTML = ic(S.settings.speak ? 'volume' : 'mute');
    renderSide();
  }
  function renderAll() {
    renderMain();
    renderAiStatus();
  }
  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-zeny-theme', t);
    else document.documentElement.removeAttribute('data-zeny-theme');
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.fn(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5500 : 3000);
  }

  // ---------- Formulários ----------
  function fieldHtml(f) {
    const id = `f-${f.name}`;
    if (f.type === 'select') {
      return `<label class="field" for="${id}">${esc(f.label)}<select id="${id}" name="${f.name}">${f.options.map(([v, l, dis]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    }
    if (f.type === 'checkbox') {
      return `<label class="field-check" for="${id}"><input id="${id}" type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    }
    const attrs = ['step', 'min', 'max', 'placeholder', 'maxlength', 'inputmode'].filter((k) => f[k] != null).map((k) => `${k}="${esc(f[k])}"`).join(' ');
    return `<label class="field" for="${id}">${esc(f.label)}<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${attrs} ${f.required ? 'required' : ''}></label>`;
  }
  function openForm(title, fields, opts = {}) {
    const dlg = $('#modal'), form = $('#modalForm');
    let body = '';
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.half && fields[i + 1] && fields[i + 1].half) { body += `<div class="field-row">${fieldHtml(f)}${fieldHtml(fields[i + 1])}</div>`; i++; } else body += fieldHtml(f);
    }
    dlg.classList.toggle('celebrate', !!opts.celebrate);
    form.innerHTML = `${opts.celebrate ? `<div class="burst" aria-hidden="true">${ic('gift', 'lg')}</div>` : ''}<h2 id="modalTitle">${esc(title)}</h2>${opts.intro ? `<p class="intro">${esc(opts.intro)}</p>` : ''}${body}
      <div class="actions">
        ${opts.danger ? `<button type="button" class="btn danger" data-close="delete" aria-label="${esc(opts.danger)}" title="${esc(opts.danger)}">${ic('trash', 'sm')}</button>` : ''}
        <button type="button" class="btn ghost" data-close="cancel">${esc(opts.cancel || 'Cancelar')}</button>
        <button type="submit" class="btn primary" value="ok">${esc(opts.ok || 'Salvar')}</button>
      </div>`;
    dlg.returnValue = '';
    // Enter sempre salva: excluir e cancelar não são botões de envio.
    $$('[data-close]', form).forEach((b) => { b.onclick = () => dlg.close(b.dataset.close); });
    dlg.showModal();
    const first = form.querySelector('input:not([type="checkbox"]), select');
    if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
    return new Promise((resolve) => {
      dlg.onclose = () => {
        const action = dlg.returnValue;
        if (action !== 'ok' && action !== 'delete') return resolve(null);
        const values = {};
        for (const f of fields) {
          const el = form.elements[f.name];
          values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
        }
        resolve({ action, values });
      };
    });
  }
  const askConfirm = async (title, text, okLabel) => !!(await openForm(title, [], { intro: text, ok: okLabel, noFocus: true }));

  const catOptions = (type) => CAT_NAMES.filter((c) => (type === 'in' ? ['Salário', 'Vendas', 'Outras receitas', 'Outros'].includes(c) : !['Salário', 'Vendas', 'Outras receitas'].includes(c))).map((c) => [c, c]);
  const scopeOptions = () => [['pessoal', 'Pessoal'], ['empresa', allowed('business') ? 'Empresa' : `Empresa (plano ${planWith('business')?.name || 'superior'})`, !allowed('business')]];

  async function txForm(existing, type = 'out') {
    const x = existing || { type, amount: '', desc: '', cat: type === 'in' ? 'Outras receitas' : 'Outros', scope: 'pessoal', date: today() };
    const r = await openForm(existing ? 'Editar lançamento' : type === 'in' ? 'Nova entrada' : 'Novo gasto', [
      { name: 'type', label: 'Tipo', type: 'select', value: x.type, options: [['out', 'Saída'], ['in', 'Entrada']] },
      { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', value: x.amount, required: true, half: true },
      { name: 'date', label: 'Data', type: 'date', value: x.date, required: true, half: true },
      { name: 'desc', label: 'Descrição', value: x.desc, required: true, maxlength: 80, placeholder: 'Ex.: Mercado' },
      { name: 'cat', label: 'Categoria', type: 'select', value: x.cat, options: [...new Set([...catOptions(x.type), [x.cat, x.cat]].map(JSON.stringify))].map(JSON.parse) },
      { name: 'scope', label: 'Conta', type: 'select', value: x.scope, options: scopeOptions() },
    ], { danger: existing ? 'Excluir lançamento' : null });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.tx = S.tx.filter((t) => t.id !== existing.id); });
      undoToast('Lançamento excluído', id);
      return;
    }
    const v = r.values;
    const amount = Math.abs(Number(v.amount));
    if (!amount || !isYmd(v.date)) { toast('Confira o valor e a data.'); return; }
    const data = { type: v.type === 'in' ? 'in' : 'out', amount, desc: cap(v.desc.trim()) || 'Lançamento', cat: v.cat, scope: v.scope === 'empresa' && allowed('business') ? 'empresa' : 'pessoal', date: v.date };
    const { id } = commit(() => {
      if (existing) Object.assign(S.tx.find((t) => t.id === existing.id) || {}, data);
      else S.tx.push({ id: uid(), auto: false, subId: null, ...data });
    });
    undoToast(existing ? 'Lançamento atualizado' : 'Lançamento adicionado', id);
  }

  async function taskForm(existing) {
    const t = existing || { title: '', due: '', time: '', prio: 'media' };
    const r = await openForm(existing ? 'Editar tarefa' : 'Nova tarefa', [
      { name: 'title', label: 'Tarefa', value: t.title, required: true, maxlength: 120, placeholder: 'Ex.: Pagar a conta de luz' },
      { name: 'due', label: 'Prazo', type: 'date', value: t.due, half: true },
      { name: 'time', label: 'Horário', type: 'time', value: t.time, half: true },
      { name: 'prio', label: 'Prioridade', type: 'select', value: t.prio, options: [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']] },
    ], { danger: existing ? 'Excluir tarefa' : null });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.tasks = S.tasks.filter((x) => x.id !== existing.id); });
      undoToast('Tarefa excluída', id);
      return;
    }
    const v = r.values;
    if (!v.title.trim()) return;
    const data = { title: cap(v.title.trim()), due: isYmd(v.due) ? v.due : '', time: v.time || '', prio: v.prio };
    const { id } = commit(() => {
      if (existing) Object.assign(S.tasks.find((x) => x.id === existing.id) || {}, data);
      else S.tasks.push({ id: uid(), done: false, doneAt: null, ...data });
    });
    undoToast(existing ? 'Tarefa atualizada' : 'Tarefa criada', id);
  }

  async function habitForm(existing) {
    if (!existing && !underLimit('habits', S.habits.length)) { gate(`Seu plano permite até ${limitOf('habits')} hábitos.`); return; }
    const r = await openForm(existing ? 'Editar hábito' : 'Novo hábito', [
      { name: 'name', label: 'Nome do hábito', value: existing ? existing.name : '', required: true, maxlength: 60, placeholder: 'Ex.: Beber 2L de água' },
    ], { danger: existing ? 'Excluir hábito' : null });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.habits = S.habits.filter((h) => h.id !== existing.id); });
      undoToast('Hábito excluído', id);
      return;
    }
    const name = cap(r.values.name.trim());
    if (!name) return;
    const { id } = commit(() => {
      if (existing) { const h = S.habits.find((x) => x.id === existing.id); if (h) h.name = name; }
      else S.habits.push({ id: uid(), name, days: {}, created: today() });
    });
    undoToast(existing ? 'Hábito atualizado' : 'Hábito criado', id);
  }

  async function goalForm(existing) {
    if (!existing && !underLimit('goals', S.goals.length)) { gate(`Seu plano permite até ${limitOf('goals')} meta(s).`); return; }
    const g = existing || { name: '', target: '', saved: 0 };
    const fields = [
      { name: 'name', label: 'Nome da meta', value: g.name, required: true, maxlength: 60, placeholder: 'Ex.: Viagem de férias' },
      { name: 'target', label: 'Quanto quer juntar (R$)', type: 'number', step: '0.01', min: '1', inputmode: 'decimal', value: g.target, required: true, half: true },
      { name: 'saved', label: 'Já guardado (R$)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: g.saved, half: true },
    ];
    if (existing) fields.push({ name: 'add', label: 'Guardar agora (R$)', type: 'number', step: '0.01', inputmode: 'decimal', placeholder: 'Ex.: 200' });
    const r = await openForm(existing ? existing.name : 'Nova meta', fields, { danger: existing ? 'Excluir meta' : null });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.goals = S.goals.filter((x) => x.id !== existing.id); });
      undoToast('Meta excluída', id);
      return;
    }
    const v = r.values;
    const target = Math.abs(Number(v.target));
    if (!v.name.trim() || !target) { toast('Confira o nome e o valor da meta.'); return; }
    const saved = Math.max(0, (Number(v.saved) || 0) + (Number(v.add) || 0));
    const { id } = commit(() => {
      const data = { name: cap(v.name.trim()), target, saved };
      if (existing) Object.assign(S.goals.find((x) => x.id === existing.id) || {}, data);
      else S.goals.push({ id: uid(), ...data });
    });
    undoToast(existing ? 'Meta atualizada' : 'Meta criada', id);
  }

  async function subForm(existing) {
    const s = existing || { name: '', amount: '', day: new Date().getDate(), cat: 'Assinaturas', scope: 'pessoal', autoPost: true };
    const fields = [
      { name: 'name', label: 'Nome', value: s.name, required: true, maxlength: 60, placeholder: 'Ex.: Spotify' },
      { name: 'amount', label: 'Valor por mês (R$)', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', value: s.amount, required: true, half: true },
      { name: 'day', label: 'Dia da cobrança', type: 'number', min: '1', max: '31', value: s.day, required: true, half: true },
      { name: 'cat', label: 'Categoria', type: 'select', value: s.cat, options: catOptions('out') },
      { name: 'scope', label: 'Conta', type: 'select', value: s.scope, options: scopeOptions() },
    ];
    if (allowed('autoSubs')) fields.push({ name: 'autoPost', label: 'Lançar automaticamente no dia da cobrança', type: 'checkbox', value: s.autoPost !== false });
    const r = await openForm(existing ? 'Editar assinatura' : 'Nova assinatura', fields, { danger: existing ? 'Excluir assinatura' : null });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.subs = S.subs.filter((x) => x.id !== existing.id); });
      undoToast('Assinatura excluída', id);
      return;
    }
    const v = r.values;
    const amount = Math.abs(Number(v.amount));
    const day = Math.min(31, Math.max(1, Number(v.day) || 1));
    if (!v.name.trim() || !amount) { toast('Confira o nome e o valor.'); return; }
    const data = { name: cap(v.name.trim()), amount, day, cat: v.cat, scope: v.scope === 'empresa' && allowed('business') ? 'empresa' : 'pessoal', autoPost: v.autoPost !== false };
    const { id } = commit(() => {
      if (existing) {
        const x = S.subs.find((q) => q.id === existing.id);
        if (x) { if (x.day !== day) x.lastPosted = initialLastPosted(day); Object.assign(x, data); }
      } else S.subs.push({ id: uid(), lastPosted: initialLastPosted(day), ...data });
    });
    undoToast(existing ? 'Assinatura atualizada' : 'Assinatura criada', id);
  }

  async function wishForm(existing) {
    if (!existing && !underLimit('wishes', activeWishes().length)) { gate(`Seu plano permite até ${limitOf('wishes')} desejos de compra.`); return; }
    const w = existing || { name: '', price: '', saved: 0, link: '' };
    const fields = [
      { name: 'name', label: 'O que você quer comprar?', value: w.name, required: true, maxlength: 60, placeholder: 'Ex.: Bicicleta elétrica' },
      { name: 'price', label: 'Preço (R$)', type: 'number', step: '0.01', min: '1', inputmode: 'decimal', value: w.price, required: true, half: true },
      { name: 'saved', label: existing ? 'Já guardado (R$)' : 'Já tenho guardado (R$)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: w.saved || '', half: true },
      { name: 'link', label: 'Link do produto (opcional)', type: 'url', value: w.link, placeholder: 'https://…' },
    ];
    const r = await openForm(existing ? 'Editar desejo' : 'Quero comprar', fields, { intro: existing ? '' : 'Vá guardando aos poucos. Quando você juntar o valor, o Zeny te avisa.', danger: existing ? 'Excluir desejo' : null, ok: existing ? 'Salvar' : 'Adicionar' });
    if (!r) return;
    if (r.action === 'delete') {
      const { id } = commit(() => { S.wishes = S.wishes.filter((x) => x.id !== existing.id); });
      undoToast('Desejo excluído', id);
      return;
    }
    const v = r.values;
    const price = Math.abs(Number(v.price));
    if (!v.name.trim() || !price) { toast('Confira o nome e o preço.'); return; }
    const saved = Math.max(0, Number(v.saved) || 0);
    const link = /^https?:\/\//.test(v.link.trim()) ? v.link.trim() : '';
    if (!existing) {
      const { undoId } = applyActions([{ type: 'add_wish', name: v.name, price, saved, link }]);
      if (undoId) undoToast('Desejo adicionado', undoId);
      return;
    }
    const { id } = commit(() => {
      const x = S.wishes.find((q) => q.id === existing.id);
      if (!x) return;
      if (saved !== x.saved) x.deposits.push({ date: today(), amount: saved - x.saved });
      Object.assign(x, { name: cap(v.name.trim()), price, saved, link });
    });
    undoToast('Desejo atualizado', id);
  }
  async function depositForm(w) {
    const r = await openForm(`Guardar para ${w.name}`, [
      { name: 'amount', label: 'Quanto você guardou? (R$)', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, placeholder: 'Ex.: 200' },
      { name: 'mode', label: 'Operação', type: 'select', value: 'add', options: [['add', 'Guardar'], ['remove', 'Retirar']] },
    ], { intro: `Você tem ${money(w.saved)} de ${money(w.price)}. Faltam ${money(Math.max(0, w.price - w.saved))}.`, ok: 'Confirmar' });
    if (!r) return;
    const amount = Math.abs(Number(r.values.amount));
    if (!amount) return;
    const { undoId } = applyActions([{ type: 'add_to_wish', id: w.id, name: w.name, amount: r.values.mode === 'remove' ? -amount : amount }]);
    if (undoId) undoToast(r.values.mode === 'remove' ? 'Valor retirado' : `Guardado para ${w.name}`, undoId);
  }
  async function buyForm(w) {
    const r = await openForm(`Comprei: ${w.name}`, [
      { name: 'paid', label: 'Quanto você pagou? (R$)', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', value: w.price, required: true },
      { name: 'expense', label: 'Lançar como gasto em Finanças', type: 'checkbox', value: true },
    ], { intro: 'O item vai para a lista de comprados.', ok: 'Registrar compra' });
    if (!r) return;
    const { undoId } = applyActions([{ type: 'buy_wish', id: w.id, name: w.name, price_paid: Number(r.values.paid) || w.price, register_expense: !!r.values.expense }]);
    if (undoId) undoToast(`${w.name} comprado. Parabéns!`, undoId);
  }

  async function budgetForm() {
    const r = await openForm('Orçamento do mês', [
      { name: 'budget', label: 'Quanto você quer gastar por mês (R$)', type: 'number', step: '50', min: '0', inputmode: 'decimal', value: Number(S.settings.budget) || '', placeholder: 'Ex.: 3000' },
    ], { intro: 'O Zeny mostra quanto falta e avisa quando os gastos chegarem perto do limite.' });
    if (!r) return;
    const v = Math.max(0, Number(r.values.budget) || 0);
    const { id } = commit(() => { S.settings.budget = v; });
    undoToast(v ? `Orçamento: ${money(v)} por mês` : 'Orçamento removido', id);
  }

  // ---------- Planos: escolha ----------
  async function choosePlan(planId) {
    const p = PLANS.find((x) => x.id === planId);
    if (!p) return;
    const intro = ENFORCE
      ? `As assinaturas do plano ${p.name} abrem em breve.`
      : `As assinaturas abrem em breve. Enquanto isso, você pode ativar o plano ${p.name} em modo de teste para ver como ele funciona.`;
    const r = await openForm(`Plano ${p.name}`, [], { intro, ok: ENFORCE ? 'Entendi' : 'Ativar em teste', noFocus: true });
    if (r && !ENFORCE) {
      S.settings.plan = p.id;
      save(); renderAll();
      toast(`Plano ${p.name} ativado em modo de teste`);
    }
  }

  // ---------- Dados ----------
  async function exportData() {
    if (!allowed('export')) { gate(`Exportar backup faz parte do plano ${planWith('export')?.name || 'superior'}.`); return; }
    const copy = JSON.parse(JSON.stringify(S));
    delete copy.settings.serverUrl;
    const json = JSON.stringify(copy, null, 2);
    const filename = `zeny-backup-${today()}.json`;
    if (downloadsApi) {
      try { await downloadsApi.save({ filename, data: json }); toast('Backup salvo'); }
      catch (e) { if (e && e.code !== 'declined') toast('Não foi possível salvar o backup aqui.'); }
      return;
    }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('Não foi possível salvar o backup aqui.'); }
  }
  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !Array.isArray(data.tx)) throw new Error('formato');
      if (!(await askConfirm('Importar backup', `Os dados atuais serão substituídos pelos do arquivo "${file.name}".`, 'Importar'))) return;
      const keep = { serverUrl: S.settings.serverUrl, onboarded: true };
      S = migrate(data);
      Object.assign(S.settings, keep);
      undoStack.length = 0;
      save(); applyTheme(); renderAll(); renderChat(); renderSuggestions();
      toast('Backup importado');
    } catch (e) { toast('Esse arquivo não é um backup válido do Zeny.'); }
  }
  function resetData(keepDemo = false) {
    const settings = { ...S.settings, budget: 0 };
    S = defaults();
    S.settings = Object.assign(S.settings, settings, { onboarded: true });
    S.demo = keepDemo;
    undoStack.length = 0;
    save();
  }

  // ---------- Exemplo ----------
  function seedDemo() {
    resetData(true);
    const now = new Date();
    let seed = 11;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const addTx = (ago, day, type, amount, desc, cat, sc = 'pessoal') => {
      const dt = new Date(now.getFullYear(), now.getMonth() - ago, day);
      if (dt > now) return;
      S.tx.push({ id: uid(), type, amount: Math.round(amount * 100) / 100, desc, cat, scope: sc, date: ymd(dt), auto: false, subId: null });
    };
    for (let i = 5; i >= 0; i--) {
      addTx(i, 5, 'in', 4200, 'Salário', 'Salário');
      addTx(i, 12, 'in', 600 + Math.round(rnd() * 900), 'Projeto para cliente', 'Vendas', 'empresa');
      addTx(i, 10, 'out', 1350, 'Aluguel', 'Moradia');
      addTx(i, 15, 'out', 140 + rnd() * 60, 'Conta de luz', 'Moradia');
      ['Mercado', 'Supermercado', 'Feira', 'Padaria'].forEach((d, k) => addTx(i, 2 + k * 7, 'out', 90 + rnd() * 160, d, 'Alimentação'));
      addTx(i, 8, 'out', 35 + rnd() * 40, 'iFood', 'Alimentação');
      addTx(i, 18, 'out', 60 + rnd() * 90, 'Uber', 'Transporte');
      addTx(i, 21, 'out', 180 + rnd() * 80, 'Gasolina', 'Transporte');
      addTx(i, 6, 'out', 99.9, 'Academia', 'Saúde');
      if (i % 2 === 0) addTx(i, 19, 'out', 70 + rnd() * 120, 'Farmácia', 'Saúde');
      if (i % 3 !== 1) addTx(i, 24, 'out', 90 + rnd() * 150, 'Cinema e jantar', 'Lazer');
      if (i % 2 === 1) addTx(i, 16, 'out', 120 + rnd() * 200, 'Roupas', 'Compras');
    }
    const key = monthKey(now);
    const soonDay = ((now.getDate() + 2) % 28) + 1;
    S.subs = [
      { id: uid(), name: 'Netflix', amount: 55.9, day: 14, cat: 'Assinaturas', scope: 'pessoal', autoPost: true, lastPosted: key },
      { id: uid(), name: 'Spotify', amount: 21.9, day: soonDay, cat: 'Assinaturas', scope: 'pessoal', autoPost: true, lastPosted: key },
      { id: uid(), name: 'Internet fibra', amount: 119.9, day: 20, cat: 'Moradia', scope: 'pessoal', autoPost: true, lastPosted: key },
    ];
    S.goals = [
      { id: uid(), name: 'Viagem para o Nordeste', target: 6000, saved: 2350 },
      { id: uid(), name: 'Reserva de emergência', target: 10000, saved: 4100 },
    ];
    const habits = [['Beber 2L de água', 0.85, 9], ['Ler 10 páginas', 0.6, 4], ['Treinar', 0.5, 0], ['Meditar 5 minutos', 0.45, 2]];
    S.habits = habits.map(([name, p, run]) => {
      const days = {};
      for (let i = 45; i >= 1; i--) if (rnd() < p) days[ymd(addDays(now, -i))] = true;
      for (let i = 1; i <= run; i++) days[ymd(addDays(now, -i))] = true;
      if (run) delete days[ymd(addDays(now, -(run + 1)))];
      if (name === 'Beber 2L de água') days[today()] = true;
      return { id: uid(), name, days, created: ymd(addDays(now, -45)) };
    });
    const d = (n) => ymd(addDays(now, n));
    S.tasks = [
      { id: uid(), title: 'Pagar fatura do cartão', prio: 'alta', due: d(-1), time: '', done: false, doneAt: null },
      { id: uid(), title: 'Ligar para o dentista', prio: 'media', due: d(0), time: '10:00', done: false, doneAt: null },
      { id: uid(), title: 'Enviar orçamento para o cliente', prio: 'alta', due: d(0), time: '', done: false, doneAt: null },
      { id: uid(), title: 'Comprar presente da Ana', prio: 'media', due: d(2), time: '', done: false, doneAt: null },
      { id: uid(), title: 'Renovar a CNH', prio: 'baixa', due: '', time: '', done: false, doneAt: null },
      { id: uid(), title: 'Revisar as contas do mês', prio: 'media', due: d(-2), time: '', done: true, doneAt: d(-1) },
    ];
    const dep = (n, days) => Array.from({ length: n }, (_, k) => ({ date: d(-days + k * Math.floor(days / n)), amount: 0 }));
    const mkWish = (name, price, saved, extra = {}) => {
      const deposits = dep(6, 80).map((x) => ({ ...x, amount: Math.round((saved / 6) * 100) / 100 }));
      return { id: uid(), name, price, saved, link: '', created: d(-80), reachedAt: null, notified: saved >= price, bought: false, boughtAt: null, paid: 0, deposits, ...extra };
    };
    S.wishes = [
      mkWish('iPhone 16', 5200, 3100),
      mkWish('Bicicleta elétrica', 3800, 3650),
      mkWish('Fone com cancelamento de ruído', 1200, 1200, { reachedAt: d(-2) }),
      mkWish('Air fryer', 450, 450, { bought: true, boughtAt: d(-20), paid: 429.9, notified: true }),
    ];
    S.settings.budget = 3500;
    save();
  }

  // ---------- Boas-vindas e resumo do dia ----------
  function welcome() {
    if (S.chat.length) {
      const last = S.chat[S.chat.length - 1];
      if (ymd(new Date(last.at)) !== today()) {
        const due = S.tasks.filter((t) => !t.done && t.due && t.due <= today());
        const pending = S.habits.filter((h) => !h.days[today()]);
        let text = `${greeting()}${S.settings.userName ? ', ' + S.settings.userName : ''}! `;
        text += due.length ? `Você tem ${plural(due.length, 'tarefa', 'tarefas')} para hoje:\n${due.map((t) => '• ' + t.title).join('\n')}` : 'Nenhuma tarefa urgente hoje.';
        if (pending.length) text += `\n\nHábitos de hoje: ${pending.map((h) => h.name).join(', ')}.`;
        addMsg({ role: 'bot', text });
      }
      return;
    }
    const n = S.settings.userName;
    if (S.settings.persona === 'genio') {
      addMsg({ role: 'bot', text: `Olá, chefe${n ? ' ' + n : ''}. Zeny online.\nMe conte o que aconteceu e eu organizo tudo. Alguns exemplos:\n• "Gastei 38 no almoço"\n• "Quero comprar um notebook de 4000"\n• "Me lembra de ligar pro dentista amanhã às 10h"\n• "Quanto gastei este mês?"` });
      return;
    }
    addMsg({ role: 'bot', text: `Olá${n ? ', ' + n : ''}! Eu sou o Zeny.\nMe conte o que aconteceu e eu organizo pra você. Alguns exemplos:\n• "Gastei 38 no almoço"\n• "Recebi 1.200 de um cliente da empresa"\n• "Me lembra de ligar pro dentista amanhã às 10h"\n• "Criar hábito ler 10 páginas"\n• "Quanto gastei este mês?"` });
  }

  function showOnboarding() {
    const ob = $('#onboard');
    ob.hidden = false;
    $('#onboardForm').onsubmit = (e) => {
      e.preventDefault();
      S.settings.userName = $('#obName').value.trim().slice(0, 40);
      S.settings.onboarded = true;
      save();
      ob.hidden = true;
      current = 'home';
      renderAll(); welcome(); renderSuggestions();
    };
    $('#obDemo').onclick = () => {
      const name = $('#obName').value.trim().slice(0, 40);
      seedDemo();
      if (name) S.settings.userName = name;
      save();
      ob.hidden = true;
      current = 'home';
      renderAll(); renderChat(); welcome(); renderSuggestions();
    };
  }

  // ---------- Eventos ----------
  const ACTIONS = {
    'budget': () => budgetForm(),
    'new-out': () => txForm(null, 'out'),
    'new-in': () => txForm(null, 'in'),
    'new-task': () => taskForm(null),
    'new-habit': () => habitForm(null),
    'new-goal': () => goalForm(null),
    'new-sub': () => subForm(null),
    'new-wish': () => wishForm(null),
    'wish-edit': (id) => { const x = S.wishes.find((t) => t.id === id); if (x) wishForm(x); },
    'wish-save': (id) => { const x = S.wishes.find((t) => t.id === id); if (x) depositForm(x); },
    'wish-buy': (id) => { const x = S.wishes.find((t) => t.id === id); if (x) buyForm(x); },
    'notif-enable': () => requestNotifications(),
    'persona': (id) => { S.settings.persona = id === 'genio' ? 'genio' : 'padrao'; if (id === 'genio' && S.settings.voiceStyle === 'padrao') S.settings.voiceStyle = 'confiante'; save(); renderMain(); toast(id === 'genio' ? 'Personalidade Gênio ativada. Às ordens, chefe.' : 'Personalidade padrão ativada'); },
    'voice-style': (id) => { S.settings.voiceStyle = VOICE_STYLES[id] ? id : 'padrao'; save(); renderMain(); speak(SAMPLE(), true); },
    'voice-test': () => speak(SAMPLE(), true),
    'notif-toggle': () => { S.settings.notify = S.settings.notify === false; save(); renderMain(); toast(S.settings.notify ? 'Avisos ativados' : 'Avisos desligados'); },
    'tx-edit': (id) => { const x = S.tx.find((t) => t.id === id); if (x) txForm(x); },
    'task-edit': (id) => { const x = S.tasks.find((t) => t.id === id); if (x) taskForm(x); },
    'habit-edit': (id) => { const x = S.habits.find((t) => t.id === id); if (x) habitForm(x); },
    'goal-edit': (id) => { const x = S.goals.find((t) => t.id === id); if (x) goalForm(x); },
    'sub-edit': (id) => { const x = S.subs.find((t) => t.id === id); if (x) subForm(x); },
    'task-toggle': (id) => {
      const t = S.tasks.find((x) => x.id === id);
      if (!t) return;
      const done = !t.done;
      const { id: uidv } = commit(() => { t.done = done; t.doneAt = done ? today() : null; });
      if (done) undoToast('Tarefa concluída', uidv);
    },
    'habit-today': (id) => {
      const h = S.habits.find((x) => x.id === id);
      if (!h) return;
      commit(() => { if (h.days[today()]) delete h.days[today()]; else h.days[today()] = true; });
      if (h.days[today()]) { const st = streak(h); toast(st > 1 ? `${h.name}: ${st} dias seguidos!` : `${h.name}: feito hoje!`); }
    },
    'habit-day': (id, el) => {
      const h = S.habits.find((x) => x.id === id);
      const day = el.dataset.day;
      if (!h || !isYmd(day) || day > today()) return;
      commit(() => { if (h.days[day]) delete h.days[day]; else h.days[day] = true; });
    },
    'habit-month': (id) => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); renderMain(); },
    'month-prev': () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderMain(); },
    'month-next': () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderMain(); },
    'scope': (id) => {
      if (id === 'empresa' && !allowed('business')) { gate(`Contas da empresa fazem parte do plano ${planWith('business')?.name || 'superior'}.`); return; }
      scope = id; renderMain();
    },
    'task-filter': (id) => { taskFilter = id; renderMain(); },
    'clear-done': async () => {
      const { id } = commit(() => { S.tasks = S.tasks.filter((t) => !t.done); });
      undoToast('Tarefas concluídas removidas', id);
    },
    'undo': (id) => undo(id),
    'plan-billing': (id) => { S.settings.billing = id === 'monthly' ? 'monthly' : 'annual'; save(); renderMain(); },
    'plan-choose': (id) => choosePlan(id),
    'theme': (id) => { S.settings.theme = id; save(); applyTheme(); renderMain(); },
    'speak': () => { S.settings.speak = !S.settings.speak; save(); renderAiStatus(); if (current === 'settings') renderMain(); toast(S.settings.speak ? 'O Zeny vai responder em voz alta' : 'Respostas em voz alta desligadas'); },
    'export': () => exportData(),
    'import': () => $('#importFile').click(),
    'erase': async () => {
      if (!(await askConfirm('Apagar tudo', 'Todos os lançamentos, hábitos, tarefas, metas e a conversa serão apagados deste aparelho. Essa ação não pode ser desfeita.', 'Apagar tudo'))) return;
      resetData(false);
      renderAll(); renderChat(); welcome(); renderSuggestions();
      toast('Dados apagados');
    },
    'clear-demo': async () => {
      if (!(await askConfirm('Começar do zero', 'Os dados de exemplo serão removidos. Seu nome e suas preferências continuam.', 'Limpar exemplo'))) return;
      resetData(false);
      renderAll(); renderChat(); welcome(); renderSuggestions();
      toast('Pronto! Agora é com você.');
    },
    'suggest': (id, el) => { go('chat'); handleUser(el.textContent); },
  };

  function bind() {
    document.addEventListener('click', (e) => {
      const goEl = e.target.closest('[data-go]');
      if (goEl) { e.preventDefault(); go(goEl.dataset.go); return; }
      const a = e.target.closest('[data-act]');
      if (!a || a.disabled) return;
      const fn = ACTIONS[a.dataset.act];
      if (fn) { e.preventDefault(); fn(a.dataset.id, a, e); }
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset && el.dataset.set) {
        const key = el.dataset.set;
        if (key === 'budget') {
          const v = Math.max(0, Number(el.value) || 0);
          commit(() => { S.settings.budget = v; });
        } else {
          S.settings[key] = el.value.trim();
          save();
          if (key === 'voiceURI') speak(SAMPLE(), true);
          renderAiStatus();
          if (key === 'userName' && current === 'home') renderMain();
        }
        toast('Ajuste salvo');
      }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'txSearch') { txQuery = e.target.value; $('#txRows').innerHTML = txRowsHtml(); }
      if (e.target.id === 'input') setComposer();
    });

    const input = $('#input');
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      setComposer();
      handleUser(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
    });
    $('#speakToggle').addEventListener('click', () => ACTIONS.speak());
    $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#shell').classList.contains('chat-open') && !$('#modal').open) go('back');
    });

    // Outra aba alterou os dados: recarrega.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      try { S = migrate(JSON.parse(e.newValue)); undoStack.length = 0; applyTheme(); renderAll(); renderChat(); } catch (err) { /* ignora */ }
    });
    // Voltou para o app (ou virou o dia): atualiza.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      postSubscriptions();
      renderAll();
    });
    window.matchMedia('(min-width: 1024px)').addEventListener?.('change', () => $('#shell').classList.remove('chat-open'));
  }

  // IA do claude.ai e salvamento de arquivos, quando a página roda como Artifact.
  function connectClaude() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return;
    c.use('sample').then((fn) => { if (fn) { sampleFn = fn; renderAiStatus(); if (current === 'settings') renderMain(); } }).catch(() => {});
    c.use('downloads').then((d) => { downloadsApi = d || null; }).catch(() => {});
  }

  // ---------- Início ----------
  applyTheme();
  bind();
  setupVoice();
  postSubscriptions();
  renderAll();
  renderChat();
  renderSuggestions();
  setComposer();
  connectClaude();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (current === 'settings') renderMain(); };
  refreshNotifStatus().then(() => { if (current === 'settings' || current === 'wishes') renderMain(); });
  if (!S.settings.onboarded) showOnboarding();
  else welcome();

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !native() && !window.claude) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Ganchos para testes no console.
  window.Zeny = { localParse, parseAmount, parseDue, state: () => S, seedDemo, version: VERSION };
})();
