/* Zeny — assistente pessoal com IA
 * Finanças, hábitos e tarefas organizados por conversa (texto ou voz).
 * Dados ficam no localStorage do aparelho. IA opcional via API do Claude.
 */
(() => {
  'use strict';

  // ---------- Estado ----------
  const STORE_KEY = 'zeny:v1';
  const defaults = () => ({
    tx: [], goals: [], subs: [], habits: [], tasks: [], chat: [],
    settings: { serverUrl: '', speak: false, userName: '' },
  });
  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* armazenamento indisponível */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignora */ }
  }

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const money = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s) => {
    if (!s) return '';
    if (s === today()) return 'hoje';
    if (s === ymd(addDays(new Date(), 1))) return 'amanhã';
    if (s === ymd(addDays(new Date(), -1))) return 'ontem';
    return parseYmd(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- Categorias ----------
  const CATS = {
    'Alimentação': ['mercado', 'supermercado', 'restaurante', 'lanche', 'ifood', 'comida', 'padaria', 'almoco', 'jantar', 'cafe', 'pizza', 'acougue', 'feira', 'hamburguer', 'sorvete'],
    'Transporte': ['uber', 'gasolina', 'combustivel', 'onibus', 'estacionamento', 'pedagio', 'taxi', 'metro', 'carro', 'mecanico', 'passagem'],
    'Moradia': ['aluguel', 'luz', 'energia', 'agua', 'condominio', 'internet', 'gas', 'iptu', 'reforma', 'movel'],
    'Saúde': ['farmacia', 'remedio', 'medico', 'academia', 'dentista', 'consulta', 'exame', 'plano de saude', 'hospital'],
    'Lazer': ['cinema', 'bar', 'show', 'viagem', 'festa', 'jogo', 'passeio', 'cerveja', 'balada'],
    'Educação': ['curso', 'escola', 'faculdade', 'livro', 'material escolar', 'mensalidade escolar'],
    'Compras': ['roupa', 'loja', 'shopping', 'presente', 'amazon', 'mercado livre', 'shopee', 'tenis', 'celular'],
    'Assinaturas': ['netflix', 'spotify', 'prime', 'disney', 'youtube', 'assinatura', 'hbo', 'globoplay', 'icloud'],
    'Contas': ['cartao', 'fatura', 'boleto', 'emprestimo', 'juros', 'imposto', 'taxa'],
    'Salário': ['salario', 'pagamento do trabalho', 'holerite'],
    'Vendas': ['venda', 'vendi', 'cliente', 'servico', 'freela', 'freelance', 'faturei'],
  };
  function guessCat(text, type) {
    const t = norm(text);
    for (const [cat, words] of Object.entries(CATS)) {
      if (words.some((w) => new RegExp(`\\b${w}`).test(t))) return cat;
    }
    return type === 'in' ? 'Outras receitas' : 'Outros';
  }
  const guessScope = (text) => /\b(empresa|negocio|cnpj|mei|cliente|firma|loja da empresa)\b/.test(norm(text)) ? 'empresa' : 'pessoal';

  // ---------- Ações (compartilhadas entre IA e parser local) ----------
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

  function applyActions(actions) {
    const chips = [];
    for (const a of actions || []) {
      try {
        switch (a.type) {
          case 'add_transaction': {
            const amount = Math.abs(Number(a.amount));
            if (!amount) break;
            const type = a.kind === 'in' || a.transaction_type === 'in' || a.direction === 'in' ? 'in' : 'out';
            const desc = a.description || a.category || 'Lançamento';
            S.tx.push({
              id: uid(), type, amount, desc: cap(desc),
              cat: a.category || guessCat(desc, type),
              scope: a.scope === 'empresa' ? 'empresa' : 'pessoal',
              date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : today(),
            });
            chips.push(`${type === 'in' ? '💵 +' : '💸 −'}${money(amount)} · ${cap(desc)}`);
            break;
          }
          case 'add_task': {
            if (!a.title) break;
            S.tasks.push({
              id: uid(), title: cap(a.title), prio: ['alta', 'media', 'baixa'].includes(a.priority) ? a.priority : 'media',
              due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '', time: a.time || '', done: false,
            });
            chips.push(`📝 ${cap(a.title)}${a.due ? ' · ' + fmtDate(a.due) : ''}`);
            break;
          }
          case 'complete_task': {
            const t = findByName(S.tasks.filter((x) => !x.done), a.title, 'title');
            if (t) { t.done = true; t.doneAt = today(); chips.push(`✅ ${t.title}`); }
            break;
          }
          case 'add_habit': {
            if (!a.name || S.habits.some((h) => norm(h.name) === norm(a.name))) break;
            S.habits.push({ id: uid(), name: cap(a.name), days: {} });
            chips.push(`🔥 Novo hábito: ${cap(a.name)}`);
            break;
          }
          case 'check_habit': {
            const h = findByName(S.habits, a.name);
            if (h) { h.days[a.date || today()] = true; chips.push(`🔥 ${h.name} · ${streak(h)} dia(s) seguidos`); }
            break;
          }
          case 'add_goal': {
            if (!a.name || !Number(a.target)) break;
            S.goals.push({ id: uid(), name: cap(a.name), target: Number(a.target), saved: Number(a.saved) || 0 });
            chips.push(`🎯 Meta: ${cap(a.name)} · ${money(Number(a.target))}`);
            break;
          }
          case 'add_to_goal': {
            const g = findByName(S.goals, a.name) || (S.goals.length === 1 ? S.goals[0] : null);
            if (g && Number(a.amount)) { g.saved += Number(a.amount); chips.push(`🎯 ${g.name}: ${money(g.saved)} de ${money(g.target)}`); }
            break;
          }
          case 'add_subscription': {
            if (!a.name || !Number(a.amount)) break;
            S.subs.push({ id: uid(), name: cap(a.name), amount: Number(a.amount), day: Number(a.day) || new Date().getDate() });
            chips.push(`🔁 ${cap(a.name)} · ${money(Number(a.amount))}/mês`);
            break;
          }
        }
      } catch (e) { console.warn('Ação ignorada', a, e); }
    }
    save();
    renderAll();
    return chips;
  }

  // ---------- Consultas ----------
  function monthTx(y, m, scope = 'all') {
    return S.tx.filter((t) => {
      const d = parseYmd(t.date);
      return d.getFullYear() === y && d.getMonth() === m && (scope === 'all' || t.scope === scope);
    });
  }
  function totals(list) {
    const inc = list.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0);
    const out = list.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0);
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

  function financeSummary() {
    const now = new Date();
    const list = monthTx(now.getFullYear(), now.getMonth());
    const t = totals(list);
    const cats = byCat(list).slice(0, 3).map(([c, v]) => `• ${c}: ${money(v)}`).join('\n');
    const subs = S.subs.reduce((s, x) => s + x.amount, 0);
    return `Neste mês:\nEntradas: ${money(t.inc)}\nSaídas: ${money(t.out)}\nSaldo: ${money(t.bal)}` +
      (cats ? `\n\nOnde mais gastou:\n${cats}` : '') +
      (subs ? `\n\nAssinaturas: ${money(subs)}/mês` : '');
  }
  function tasksSummary() {
    const open = S.tasks.filter((t) => !t.done).sort(sortTasks);
    if (!open.length) return 'Você não tem tarefas pendentes. 🎉';
    return `Você tem ${open.length} tarefa(s) pendente(s):\n` +
      open.slice(0, 8).map((t) => `• ${t.title}${t.due ? ` (${fmtDate(t.due)}${t.time ? ' ' + t.time : ''})` : ''}${t.prio === 'alta' ? ' ❗' : ''}`).join('\n');
  }
  function habitsSummary() {
    if (!S.habits.length) return 'Você ainda não tem hábitos. Diga, por exemplo: "criar hábito ler 10 páginas".';
    return 'Seus hábitos hoje:\n' + S.habits.map((h) => `${h.days[today()] ? '✅' : '⬜'} ${h.name} — 🔥 ${streak(h)}`).join('\n');
  }

  // ---------- Parser local (português) ----------
  const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|k)\b)?(\s*(?:reais|real|conto|pila))?/i;
  function parseAmount(text) {
    const m = text.match(AMOUNT_RE);
    if (!m) return null;
    let s = m[1];
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    let v = parseFloat(s);
    if (m[2]) v *= 1000;
    return { value: v, raw: m[0] };
  }

  const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  function parseDue(t) {
    const now = new Date();
    let due = '', time = '', rawParts = [];
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
        const re = new RegExp(`\\b(na |no |nesta |neste |proxima |proximo )?${WEEKDAYS[i]}(-feira)?\\b`);
        const m = t.match(re);
        if (m) {
          let diff = (i - now.getDay() + 7) % 7 || 7;
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

  function localParse(input) {
    input = input.normalize('NFC').replace(/[!?.]+$/g, '').trim();
    const t = norm(input); // mesmo tamanho do input: índices batem para recuperar acentos
    const orig = (frag) => { const i = t.indexOf(frag); return i >= 0 ? input.slice(i, i + frag.length) : frag; };
    const amt = parseAmount(t);

    // Saudações e ajuda
    if (/^(oi|ola|e ai|bom dia|boa tarde|boa noite|hey|opa)\b/.test(t) && t.split(' ').length <= 4) {
      return { reply: `${greeting()}${S.settings.userName ? ', ' + S.settings.userName : ''}! Como posso ajudar? Pode me contar um gasto, pedir um lembrete ou marcar um hábito.` };
    }
    if (/\b(ajuda|o que voce faz|como funciona|comandos)\b/.test(t)) return { reply: HELP };

    // Consultas
    if (/\b(quanto (eu )?gastei|meus gastos|saldo|resumo financeiro|balanco|como estao (minhas )?financas|quanto (eu )?recebi)\b/.test(t)) return { reply: financeSummary() };
    if (/\b(minhas tarefas|quais (sao as )?tarefas|o que (eu )?(tenho|preciso) (pra|para|que) fazer|tarefas pendentes|lista de tarefas|minha agenda)\b/.test(t)) return { reply: tasksSummary() };
    if (/\b(meus habitos|como estao (meus )?habitos|habitos de hoje)\b/.test(t)) return { reply: habitsSummary() };
    if (/\b(minhas metas|como estao (minhas )?metas)\b/.test(t)) {
      return { reply: S.goals.length ? S.goals.map((g) => `🎯 ${g.name}: ${money(g.saved)} de ${money(g.target)} (${Math.round((g.saved / g.target) * 100)}%)`).join('\n') : 'Nenhuma meta ainda. Ex.: "meta de juntar 3000 para viagem".' };
    }

    // Assinaturas
    if (/\b(assinatura|mensalidade|assinei)\b/.test(t) && amt) {
      const day = (t.match(/\bdia\s+(\d{1,2})\b/) || [])[1];
      const name = stripWords(orig(t).toLowerCase().replace(amt.raw, '').replace(/\bdia\s+\d{1,2}\b/, ''), ['assinatura', 'mensalidade', 'assinei', 'nova', 'do', 'da', 'de', 'o', 'a', 'por', 'mes', 'mensal', 'todo', 'cobrada', 'no', 'na']) || 'Assinatura';
      return { actions: [{ type: 'add_subscription', name, amount: amt.value, day }], reply: `Assinatura registrada. Vou considerar ${money(amt.value)} todo mês.` };
    }

    // Metas
    if (/\bmeta\b/.test(t) && amt && /\b(criar|nova|meta de|quero|juntar|guardar|economizar)\b/.test(t) && !/\b(guardei|economizei|poupei|depositei)\b/.test(t)) {
      const nm = (t.match(/\b(?:para|pra|p\/)\s+(?:o |a |uma? )?(.+)$/) || [])[1];
      const name = nm ? orig(nm).replace(amt.raw, '').trim() : 'Minha meta';
      return { actions: [{ type: 'add_goal', name, target: amt.value }], reply: `Meta criada! Me avise quando guardar dinheiro, ex.: "guardei 100 para ${name}".` };
    }
    if (/\b(guardei|economizei|poupei|depositei|separei)\b/.test(t) && amt) {
      const g = S.goals.find((x) => t.includes(norm(x.name))) || findByName(S.goals, t.replace(amt.raw, '')) || (S.goals.length === 1 ? S.goals[0] : null);
      if (g) return { actions: [{ type: 'add_to_goal', name: g.name, amount: amt.value }], reply: 'Boa! Cada passo conta. 💪' };
      return { reply: 'Anotei mentalmente, mas você ainda não tem uma meta com esse nome. Crie uma: "meta de juntar 2000 para reserva".' };
    }

    // Criar hábito
    const hm = t.match(/\b(?:criar|novo|nova|adicionar|comecar)\s+(?:o\s+|um\s+)?(?:habito|rotina)\s+(?:de\s+)?(.+)$/) || t.match(/^(?:habito|rotina)[:\s]+(?:de\s+)?(.+)$/) || t.match(/\bquero criar o habito de\s+(.+)$/);
    if (hm) return { actions: [{ type: 'add_habit', name: orig(hm[1]) }], reply: 'Hábito criado! Me diga quando fizer, ex.: "fiz ' + orig(hm[1]) + '". Vou acompanhar sua sequência. 🔥' };

    // Concluir hábito / tarefa
    const doneVerb = /\b(fiz|feito|feita|conclui|terminei|completei|marquei|marca|marcar|ja|finalizei|resolvi|bebi|li|treinei|meditei|corri|estudei|caminhei)\b/.test(t);
    if (doneVerb) {
      const h = S.habits.find((x) => t.includes(norm(x.name))) || (S.habits.length ? findByName(S.habits, stripWords(t, ['fiz', 'feito', 'marquei', 'marca', 'hoje', 'ja', 'o', 'a', 'habito', 'de'])) : null);
      const tk = findByName(S.tasks.filter((x) => !x.done), stripWords(t, ['conclui', 'terminei', 'finalizei', 'resolvi', 'fiz', 'feito', 'feita', 'a', 'o', 'tarefa', 'de', 'ja']), 'title');
      if (h && !/\btarefa\b/.test(t)) return { actions: [{ type: 'check_habit', name: h.name }], reply: 'Mandou bem! Hábito marcado para hoje.' };
      if (tk && !amt) return { actions: [{ type: 'complete_task', title: tk.title }], reply: 'Tarefa concluída. Menos uma! ✅' };
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
      return { actions, reply: () => (type === 'in' ? 'Entrada registrada! 💵' : 'Gasto registrado. ' + budgetHint()) };
    }

    // Tarefas
    if (taskHint || /\b(me lembra|agendar|marcar consulta|ligar para|ligar pra|comprar|pagar|enviar|mandar|buscar|levar)\b/.test(t)) {
      const { due, time, rawParts } = parseDue(t);
      let title = input.trim();
      let n = norm(title);
      const prefixes = /^(me\s+lembr[ae]\s+(de\s+)?|lembr[ae]r?(-me)?\s+(de\s+|que\s+)?|lembrete[:\s]+(de\s+|para\s+)?|nova\s+tarefa[:\s]+|tarefa[:\s]+|adicionar\s+tarefa[:\s]+|preciso\s+(de\s+)?|tenho\s+que\s+|nao\s+(posso\s+)?esquecer\s+(de\s+)?|nao\s+deixar\s+de\s+)/;
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
          reply: `Pode deixar, vou te lembrar${due ? ' ' + fmtDate(due) : ''}${time ? ' às ' + time : ''}. 📝`,
        };
      }
    }

    if (amt) return { reply: `Entendi o valor ${money(amt.value)}, mas foi um gasto ou uma entrada? Ex.: "gastei ${amt.value} no mercado" ou "recebi ${amt.value}".` };
    return { reply: 'Não entendi muito bem. 🤔\n' + HELP + (serverUrl() ? '' : '\n\nDica: conecte o servidor da IA em Ajustes para conversar livremente.') };
  }

  const STOP_MONEY = ['gastei', 'paguei', 'comprei', 'recebi', 'ganhei', 'vendi', 'entrou', 'caiu', 'torrei', 'me', 'pagaram', 'hoje', 'ontem', 'amanha', 'amanhã', 'com', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'em', 'pra', 'para', 'o', 'a', 'os', 'as', 'um', 'uma', 'reais', 'real', 'r\\$', 'eu', 'foi', 'pela', 'pelo', 'empresa', 'pessoal', 'mais', 'uns', 'umas', 'e'];
  function budgetHint() {
    const now = new Date();
    const t = totals(monthTx(now.getFullYear(), now.getMonth()));
    return `Total de gastos no mês: ${money(t.out)}.`;
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }
  const HELP = 'Você pode me dizer coisas como:\n• "Gastei 35 no almoço"\n• "Recebi 1200 de um cliente da empresa"\n• "Me lembra de ligar pro dentista amanhã às 10h"\n• "Criar hábito ler 10 páginas" e depois "li 10 páginas"\n• "Meta de juntar 5000 para viagem"\n• "Assinatura Netflix 55 dia 10"\n• "Quanto gastei este mês?" / "Minhas tarefas"';

  // ---------- IA (Claude) ----------
  function aiContext() {
    const now = new Date();
    const list = monthTx(now.getFullYear(), now.getMonth());
    const t = totals(list);
    return JSON.stringify({
      hoje: today(),
      dia_da_semana: WEEKDAYS[now.getDay()],
      nome_usuario: S.settings.userName || null,
      mes_atual: { entradas: t.inc, saidas: t.out, saldo: t.bal, por_categoria: Object.fromEntries(byCat(list)) },
      lancamentos_recentes: S.tx.slice(-25).map(({ type, amount, desc, cat, scope, date }) => ({ tipo: type, valor: amount, desc, cat, scope, date })),
      metas: S.goals.map(({ name, target, saved }) => ({ name, target, saved })),
      assinaturas: S.subs.map(({ name, amount, day }) => ({ name, amount, day })),
      habitos: S.habits.map((h) => ({ name: h.name, feito_hoje: !!h.days[today()], sequencia: streak(h) })),
      tarefas_pendentes: S.tasks.filter((x) => !x.done).map(({ title, prio, due, time }) => ({ title, prio, due, time })),
    });
  }

  // URL do servidor: a dos Ajustes tem prioridade sobre a do config.js.
  const serverUrl = () => (S.settings.serverUrl || (window.ZENY_CONFIG && window.ZENY_CONFIG.serverUrl) || '').replace(/\/+$/, '');

  // A chave da API fica só no servidor; o app manda a mensagem e o contexto.
  async function askServer(userText) {
    const history = S.chat.slice(-13, -1).map(({ role, text }) => ({ role, text }));
    const res = await fetch(serverUrl() + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: userText, history, context: aiContext() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Servidor ${res.status}`);
    return { reply: String(data.reply || ''), actions: Array.isArray(data.actions) ? data.actions : [] };
  }

  // ---------- Chat ----------
  function addMsg(role, text, chips = []) {
    S.chat.push({ role, text, chips, at: Date.now() });
    if (S.chat.length > 200) S.chat = S.chat.slice(-200);
    save();
    drawMsg(S.chat[S.chat.length - 1]);
  }
  function drawMsg(m) {
    const box = $('#messages');
    const el = document.createElement('div');
    el.className = `msg ${m.role === 'user' ? 'user' : 'bot'}`;
    el.innerHTML = esc(m.text) + (m.chips?.length ? `<div class="chips">${m.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : '');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }
  function renderChat() {
    $('#messages').innerHTML = '';
    S.chat.forEach(drawMsg);
  }

  let busy = false;
  async function handleUser(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    addMsg('user', text);
    $('#suggestions').style.display = 'none';
    let result;
    if (serverUrl()) {
      const typing = drawMsg({ role: 'bot', text: 'Zeny está pensando…' });
      typing.classList.add('typing');
      try {
        result = await askServer(text);
      } catch (e) {
        console.error(e);
        toast((e.message || 'IA indisponível') + ' — usando modo local');
        result = localParse(text);
      }
      typing.remove();
    } else {
      result = localParse(text);
    }
    const chips = applyActions(result.actions);
    if (typeof result.reply === 'function') result.reply = result.reply();
    addMsg('bot', result.reply || (chips.length ? 'Feito!' : '…'), chips);
    speak(result.reply);
    busy = false;
  }

  // No app Android (Capacitor) usamos plugins nativos; no navegador, a Web Speech API.
  const native = () => window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  const plugin = (name) => native() && window.Capacitor.Plugins && window.Capacitor.Plugins[name];

  function speak(text) {
    if (!S.settings.speak || !text) return;
    const clean = text.replace(/[•\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '');
    const tts = plugin('TextToSpeech');
    if (tts) { tts.stop().catch(() => {}).finally(() => tts.speak({ text: clean, lang: 'pt-BR', rate: 1.0 }).catch(() => {})); return; }
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'pt-BR';
    speechSynthesis.speak(u);
  }

  // ---------- Voz ----------
  function setupVoice() {
    const btn = $('#micBtn');
    const nativeSR = plugin('SpeechRecognition');
    if (nativeSR) {
      let listening = false;
      btn.addEventListener('click', async () => {
        if (listening) { nativeSR.stop().catch(() => {}); return; }
        try {
          const { available } = await nativeSR.available();
          if (!available) { toast('Reconhecimento de voz indisponível neste aparelho'); return; }
          const perm = await nativeSR.requestPermissions();
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') { toast('Permita o uso do microfone'); return; }
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
      btn.addEventListener('click', () => toast('Seu navegador não suporta voz. Tente o Chrome.'));
      return;
    }
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    let listening = false, finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      finalText = '';
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      $('#input').value = finalText || interim;
    };
    rec.onend = () => {
      listening = false;
      btn.classList.remove('rec');
      const v = $('#input').value;
      if (v.trim()) { $('#input').value = ''; handleUser(v); }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('O microfone está bloqueado nesta página. Libere o acesso ou digite a mensagem.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Erro no microfone: ' + e.error);
    };
    btn.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      $('#input').value = '';
      try { rec.start(); listening = true; btn.classList.add('rec'); } catch (e) { /* já iniciado */ }
    });
  }

  // ---------- Finanças ----------
  let viewMonth = new Date(); viewMonth.setDate(1);
  let scope = 'all';
  function renderFinance() {
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    $('#monthLabel').textContent = cap(viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    const list = monthTx(y, m, scope);
    const t = totals(list);
    $('#sumIn').textContent = money(t.inc);
    $('#sumOut').textContent = money(t.out);
    $('#sumBal').textContent = money(t.bal);
    $('#sumBal').className = t.bal >= 0 ? 'pos' : 'neg';

    const cats = byCat(list);
    const max = cats[0]?.[1] || 1;
    $('#catBars').innerHTML = cats.length ? cats.map(([c, v]) =>
      `<div class="bar-row"><div class="top"><span>${esc(c)}</span><span>${money(v)}</span></div><div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`).join('')
      : '<div class="empty">Sem gastos neste mês.</div>';

    $('#goals').innerHTML = S.goals.length ? S.goals.map((g) => {
      const p = Math.min(100, (g.saved / g.target) * 100);
      return `<div class="item"><div class="grow"><div class="title">🎯 ${esc(g.name)}</div><div class="sub">${money(g.saved)} de ${money(g.target)} · ${Math.round(p)}%</div><div class="bar" style="margin-top:6px"><i style="width:${p}%"></i></div></div><button class="del" data-del="goals:${g.id}">×</button></div>`;
    }).join('') : '<div class="empty">Diga: "meta de juntar 3000 para viagem"</div>';

    const subTotal = S.subs.reduce((s, x) => s + x.amount, 0);
    $('#subs').innerHTML = S.subs.length ? S.subs.map((s) =>
      `<div class="item"><div class="grow"><div class="title">🔁 ${esc(s.name)}</div><div class="sub">Todo dia ${s.day}</div></div><b>${money(s.amount)}</b><button class="del" data-del="subs:${s.id}">×</button></div>`).join('') +
      `<div class="sub" style="text-align:right;color:var(--muted);font-size:13px">Total mensal: ${money(subTotal)}</div>`
      : '<div class="empty">Diga: "assinatura Spotify 21,90 dia 5"</div>';

    const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
    $('#txList').innerHTML = sorted.length ? sorted.map((x) =>
      `<div class="item"><div class="grow"><div class="title">${esc(x.desc)}</div><div class="sub">${esc(x.cat)} · ${fmtDate(x.date)}${x.scope === 'empresa' ? ' · 🏢 empresa' : ''}</div></div><b class="${x.type === 'in' ? 'pos' : 'neg'}">${x.type === 'in' ? '+' : '−'}${money(x.amount)}</b><button class="del" data-del="tx:${x.id}">×</button></div>`).join('')
      : '<div class="empty">Nenhum lançamento. Fale com o Zeny: "gastei 20 no lanche".</div>';
  }

  // ---------- Hábitos ----------
  function renderHabits() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    $('#habitList').innerHTML = S.habits.length ? S.habits.map((h) => {
      let cal = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<div class="wd">${d}</div>`).join('');
      for (let i = 0; i < first.getDay(); i++) cal += '<div class="d blank"></div>';
      for (let d = 1; d <= daysIn; d++) {
        const key = ymd(new Date(now.getFullYear(), now.getMonth(), d));
        cal += `<div class="d ${h.days[key] ? 'on' : ''} ${key === today() ? 'today' : ''}" data-hday="${h.id}:${key}">${d}</div>`;
      }
      const monthCount = Object.keys(h.days).filter((k) => k.startsWith(ymd(first).slice(0, 7))).length;
      return `<div class="habit"><div class="head"><button class="check ${h.days[today()] ? 'on' : ''}" data-htoggle="${h.id}">${h.days[today()] ? '✓' : ''}</button><div class="grow" style="flex:1"><div class="title" style="font-weight:600">${esc(h.name)}</div><div class="streak">🔥 ${streak(h)} dia(s) seguidos · ${monthCount}/${daysIn} no mês</div></div><button class="del" data-del="habits:${h.id}">×</button></div><div class="cal">${cal}</div></div>`;
    }).join('') : '<div class="empty">Nenhum hábito ainda. Diga ao Zeny: "criar hábito beber 2L de água".</div>';
  }

  // ---------- Tarefas ----------
  let taskFilter = 'open';
  const PRIO_ORDER = { alta: 0, media: 1, baixa: 2 };
  function sortTasks(a, b) {
    return (a.due || '9999').localeCompare(b.due || '9999') || PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio];
  }
  function renderTasks() {
    const list = S.tasks.filter((t) => (taskFilter === 'open' ? !t.done : t.done)).sort(sortTasks);
    $('#taskList').innerHTML = list.length ? list.map((t) => {
      const overdue = !t.done && t.due && t.due < today();
      return `<div class="item task ${t.done ? 'done' : ''}"><button class="box" data-ttoggle="${t.id}">${t.done ? '✓' : ''}</button><div class="grow"><div class="title">${esc(t.title)}</div><div class="sub ${overdue ? 'overdue' : ''}">${t.due ? (overdue ? 'Atrasada · ' : '') + fmtDate(t.due) : 'Sem prazo'}${t.time ? ' · ' + t.time : ''}</div></div><span class="prio ${t.prio}">${t.prio === 'media' ? 'média' : t.prio}</span><button class="del" data-del="tasks:${t.id}">×</button></div>`;
    }).join('') : `<div class="empty">${taskFilter === 'open' ? 'Tudo em dia! Diga: "me lembra de pagar o boleto sexta".' : 'Nenhuma tarefa concluída ainda.'}</div>`;
  }

  function renderAll() { renderFinance(); renderHabits(); renderTasks(); }

  // ---------- Modal genérico ----------
  function openForm(title, fields, okLabel = 'Salvar', intro = '') {
    const dlg = $('#modal'), form = $('#modalForm');
    form.innerHTML = `<h2>${esc(title)}</h2>` + (intro ? `<p class="muted">${esc(intro)}</p>` : '') + fields.map((f) => {
      if (f.type === 'select') return `<label class="field">${esc(f.label)}<select name="${f.name}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      return `<label class="field">${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.step ? `step="${f.step}"` : ''} ${f.required ? 'required' : ''}></label>`;
    }).join('') + `<div class="actions"><button value="cancel" formnovalidate>Cancelar</button><button value="ok">${esc(okLabel)}</button></div>`;
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.onclose = () => {
        if (dlg.returnValue !== 'ok') return resolve(null);
        resolve(Object.fromEntries(new FormData(form)));
      };
    });
  }

  // Confirmação dentro do app (o confirm() do navegador nem sempre aparece).
  const askConfirm = async (title, text, okLabel) => (await openForm(title, [], okLabel, text)) !== null;

  // ---------- Eventos ----------
  function go(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
    if (view === 'settings') loadSettingsForm();
  }

  function bind() {
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#input').value;
      $('#input').value = '';
      handleUser(v);
    });
    $$('#suggestions button').forEach((b) => b.addEventListener('click', () => handleUser(b.textContent)));

    $('#prevMonth').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); renderFinance(); };
    $('#nextMonth').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); renderFinance(); };
    $$('#scopeSeg button').forEach((b) => b.addEventListener('click', () => {
      scope = b.dataset.scope;
      $$('#scopeSeg button').forEach((x) => x.classList.toggle('on', x === b));
      renderFinance();
    }));
    $$('#taskSeg button').forEach((b) => b.addEventListener('click', () => {
      taskFilter = b.dataset.f;
      $$('#taskSeg button').forEach((x) => x.classList.toggle('on', x === b));
      renderTasks();
    }));

    document.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const [coll, id] = del.dataset.del.split(':');
        if (!(await askConfirm('Excluir item', 'Esta ação não pode ser desfeita.', 'Excluir'))) return;
        S[coll] = S[coll].filter((x) => x.id !== id);
        save(); renderAll();
        return;
      }
      const ht = e.target.closest('[data-htoggle]');
      if (ht) {
        const h = S.habits.find((x) => x.id === ht.dataset.htoggle);
        if (h.days[today()]) delete h.days[today()]; else h.days[today()] = true;
        save(); renderHabits();
        return;
      }
      const hd = e.target.closest('[data-hday]');
      if (hd) {
        const [id, key] = hd.dataset.hday.split(':');
        if (key > today()) return;
        const h = S.habits.find((x) => x.id === id);
        if (h.days[key]) delete h.days[key]; else h.days[key] = true;
        save(); renderHabits();
        return;
      }
      const tt = e.target.closest('[data-ttoggle]');
      if (tt) {
        const t = S.tasks.find((x) => x.id === tt.dataset.ttoggle);
        t.done = !t.done; t.doneAt = t.done ? today() : null;
        save(); renderTasks();
      }
    });

    $('#addTx').onclick = async () => {
      const v = await openForm('Novo lançamento', [
        { name: 'kind', label: 'Tipo', type: 'select', value: 'out', options: [['out', 'Saída'], ['in', 'Entrada']] },
        { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01', required: true },
        { name: 'description', label: 'Descrição', required: true },
        { name: 'category', label: 'Categoria', type: 'select', value: 'Outros', options: [...Object.keys(CATS), 'Outros', 'Outras receitas'].map((c) => [c, c]) },
        { name: 'scope', label: 'Conta', type: 'select', value: 'pessoal', options: [['pessoal', 'Pessoal'], ['empresa', 'Empresa']] },
        { name: 'date', label: 'Data', type: 'date', value: today() },
      ]);
      if (v) applyActions([{ type: 'add_transaction', ...v }]);
    };
    $('#addHabit').onclick = async () => {
      const v = await openForm('Novo hábito', [{ name: 'name', label: 'Nome do hábito', required: true }]);
      if (v) applyActions([{ type: 'add_habit', name: v.name }]);
    };
    $('#addTask').onclick = async () => {
      const v = await openForm('Nova tarefa', [
        { name: 'title', label: 'Tarefa', required: true },
        { name: 'priority', label: 'Prioridade', type: 'select', value: 'media', options: [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']] },
        { name: 'due', label: 'Prazo', type: 'date' },
        { name: 'time', label: 'Horário', type: 'time' },
      ]);
      if (v) applyActions([{ type: 'add_task', ...v }]);
    };

    $('#saveSettings').onclick = () => {
      S.settings.serverUrl = $('#serverUrl').value.trim();
      S.settings.speak = $('#speak').checked;
      S.settings.userName = $('#userName').value.trim();
      save(); updateMode();
      toast('Ajustes salvos');
      go('chat');
    };
    $('#exportData').onclick = () => {
      const copy = { ...S };
      const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zeny-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    $('#importData').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const settings = S.settings;
        S = Object.assign(defaults(), data);
        S.settings = Object.assign({}, settings, data.settings, { serverUrl: settings.serverUrl });
        save(); renderChat(); renderAll(); updateMode();
        toast('Backup importado');
      } catch (err) { toast('Arquivo inválido'); }
      e.target.value = '';
    };
    $('#clearData').onclick = async () => {
      if (!(await askConfirm('Apagar tudo', 'Todos os lançamentos, hábitos, tarefas e a conversa serão apagados deste aparelho.', 'Apagar tudo'))) return;
      const settings = S.settings;
      S = defaults(); S.settings = settings;
      save(); renderChat(); renderAll(); welcome();
      toast('Dados apagados');
    };
  }

  function loadSettingsForm() {
    $('#serverUrl').value = S.settings.serverUrl || serverUrl();
    $('#speak').checked = S.settings.speak;
    $('#userName').value = S.settings.userName;
  }
  function updateMode() {
    const el = $('#modeLabel');
    el.textContent = serverUrl() ? 'IA conectada' : 'Modo local';
    el.classList.toggle('ai', !!serverUrl());
  }

  function welcome() {
    if (S.chat.length) {
      // Lembrete diário das tarefas do dia, uma vez por dia.
      const last = S.chat[S.chat.length - 1];
      const lastDay = last.at ? ymd(new Date(last.at)) : today();
      if (lastDay !== today()) {
        const due = S.tasks.filter((t) => !t.done && t.due && t.due <= today());
        const pending = S.habits.filter((h) => !h.days[today()]);
        let text = `${greeting()}! `;
        text += due.length ? `Você tem ${due.length} tarefa(s) para hoje ou atrasada(s):\n${due.map((t) => '• ' + t.title).join('\n')}` : 'Nenhuma tarefa urgente hoje.';
        if (pending.length) text += `\n\nHábitos de hoje: ${pending.map((h) => h.name).join(', ')}.`;
        addMsg('bot', text);
      }
      return;
    }
    addMsg('bot', `Olá! Eu sou o Zeny, seu assistente pessoal. ✨\n\nFale comigo (toque no 🎤) ou escreva, e eu organizo suas finanças, hábitos e tarefas.\n\n${HELP}`);
  }

  // ---------- Início ----------
  bind();
  setupVoice();
  updateMode();
  renderChat();
  renderAll();
  welcome();
  if (S.chat.length > 1) $('#suggestions').style.display = 'none';

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !native()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Exposto para testes no console.
  window.Zeny = { localParse, parseAmount, parseDue, state: () => S };
})();
