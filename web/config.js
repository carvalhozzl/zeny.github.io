// Configuração do Zeny. Edite este arquivo para ajustar o app sem mexer no código.
window.ZENY_CONFIG = {
  // Endereço do servidor da IA (Cloudflare Worker), que guarda a chave da API.
  // Ex.: 'https://zeny-server.SEU-USUARIO.workers.dev'. Vazio = modo local.
  serverUrl: '',

  // Contato mostrado em Ajustes e na tela de planos. Vazio = não mostrar.
  supportEmail: '',

  plans: {
    // false: os planos aparecem, mas nenhum recurso é bloqueado (bom para testar).
    // true: aplica os limites de cada plano no app.
    enforce: false,

    // Dias de teste grátis mostrados na tela de planos. null = não mostrar.
    trialDays: null,

    // Preços em reais. null = aparece "Valor em breve".
    //   monthly: preço por mês no plano mensal
    //   annual:  preço total cobrado por ano no plano anual
    // checkout: link de pagamento (Mercado Pago, Stripe, Hotmart, Kiwify...).
    //   Vazio = o botão avisa que as assinaturas abrem em breve.
    // limits: null = ilimitado.
    list: [
      {
        id: 'basico',
        name: 'Básico',
        tagline: 'Para começar a se organizar',
        monthly: null,
        annual: null,
        checkout: { monthly: '', annual: '' },
        limits: { aiMessages: 30, habits: 3, goals: 1, business: false, autoSubs: false, export: false },
        features: [
          'Finanças, hábitos e tarefas',
          'Comandos por texto e voz',
          '30 mensagens com a IA por mês',
          'Até 3 hábitos e 1 meta de economia',
        ],
      },
      {
        id: 'medio',
        name: 'Médio',
        tagline: 'Para organizar o dia a dia inteiro',
        badge: 'Mais escolhido',
        highlight: true,
        monthly: null,
        annual: null,
        checkout: { monthly: '', annual: '' },
        limits: { aiMessages: 300, habits: 10, goals: 5, business: true, autoSubs: true, export: false },
        features: [
          'Tudo do Básico',
          '300 mensagens com a IA por mês',
          'Até 10 hábitos e 5 metas',
          'Contas pessoal e da empresa separadas',
          'Assinaturas lançadas automaticamente',
        ],
      },
      {
        id: 'premium',
        name: 'Premium',
        tagline: 'Sem limites e com prioridade',
        monthly: null,
        annual: null,
        checkout: { monthly: '', annual: '' },
        limits: { aiMessages: null, habits: null, goals: null, business: true, autoSubs: true, export: true },
        features: [
          'Tudo do Médio',
          'IA sem limite de mensagens',
          'Hábitos e metas ilimitados',
          'Backup e exportação dos dados',
          'Suporte prioritário',
        ],
      },
    ],
  },
};
