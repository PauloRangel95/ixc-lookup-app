/* IXC Lookup PWA — controle de permissões por colaborador (somente UI).
 * Lê colaboradores_tokens.permissoes (Supabase) do usuário logado e ESCONDE
 * o que não estiver liberado. Camada separada — não altera popup.js.
 *
 * Config no Supabase (coluna `permissoes`): pode ser texto simples separado por
 * vírgula (mais fácil), JSON array, ou string única. Exemplos equivalentes:
 *     conexao, reboot-onu, comodatos
 *     ["conexao","reboot-onu","comodatos"]
 *   - vazio/null -> ACESSO TOTAL (compatível com o que já existe)
 *
 * CHAVES (use as que quiser, misturando seções e ações):
 *   Seções:  geral | contrato | cliente | conexao | financeiro |
 *            atendimento | os | tickets | historicos | negociacoes |
 *            servicos | comodatos | produtos | tvsva
 *   Ações:   copiar-tudo | desbloquear | desconectar | reboot-onu |
 *            agendar | enviar-email | boleto | roteador | potencia-onu
 */
(function () {
  console.log('[IXC permissoes] camada card-level carregada');
  // Lê o perfil via n8n (a chave do Supabase fica no servidor — PWA não carrega anon key)
  const PERFIL_URL = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-perfil-pwa';

  // Chave de permissão -> ids de card que ela libera (body-<id>)
  const CARDS = {
    geral: ['contrato', 'cliente'], contrato: ['contrato'], cliente: ['cliente'],
    conexao: ['logins'],
    financeiro: ['fin', 'fin-ajustes'], financas: ['fin', 'fin-ajustes'],
    atendimento: ['os-ab', 'os-en', 'tickets'], os: ['os-ab', 'os-en'], tickets: ['tickets'],
    historicos: ['hist-contrato', 'negociacoes'], negociacoes: ['negociacoes'],
    servicos: ['comodatos', 'produtos-contrato', 'tv-sva'],
    comodatos: ['comodatos'], produtos: ['produtos-contrato'], tvsva: ['tv-sva']
  };
  // Todos os cards conhecidos e a aba de cada um
  const CARD_TAB = {
    'contrato': 'geral', 'cliente': 'geral', 'logins': 'conexao',
    'fin': 'financas', 'fin-ajustes': 'financas',
    'os-ab': 'atendimento', 'os-en': 'atendimento', 'tickets': 'atendimento',
    'hist-contrato': 'historicos', 'negociacoes': 'historicos',
    'comodatos': 'servicos', 'produtos-contrato': 'servicos', 'tv-sva': 'servicos'
  };
  // Mapa de chave de ação -> data-action real (aliases amigáveis)
  const ACAO_ALIAS = { 'agendar': 'abrir-agendar', 'enviar-email': 'enviar-boleto-email' };
  const ACOES = ['copiar-tudo', 'desbloquear', 'desconectar', 'reboot-onu', 'abrir-agendar', 'enviar-boleto-email', 'boleto', 'roteador', 'potencia-onu'];
  const ORDEM_ABAS = ['geral', 'conexao', 'financas', 'atendimento', 'historicos', 'servicos'];

  let permitido = null;     // null = tudo liberado
  let loadedFor = undefined; // e-mail para o qual já carregamos

  function getSessao() {
    return new Promise(r => chrome.storage.local.get(['ixc_sessao'], d => r(d.ixc_sessao || null)));
  }

  // Recarrega as permissões quando a sessão (e-mail) muda — ex.: após o login
  async function ensureLoaded() {
    const s = await getSessao();
    const email = (s && (s.usuario_email || s.usuario_login)) || null;
    if (email !== loadedFor) { loadedFor = email; await carregar(email); }
  }

  async function carregar(email) {
    try {
      if (!email) { permitido = null; return; }
      const res = await fetch(PERFIL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const d = await res.json();
      let raw = d ? d.permissoes : null;
      if (raw == null || raw === '') { permitido = null; return; } // sem config = acesso total
      // Aceita: array JSON ["a","b"], string JSON "a", texto simples a, ou "a,b,c"
      if (typeof raw === 'string') {
        const v = raw.trim();
        try { raw = JSON.parse(v); } catch (e) { raw = v; }
      }
      if (typeof raw === 'string') raw = raw.split(',').map(x => x.trim()).filter(Boolean);
      permitido = Array.isArray(raw) ? raw.map(x => String(x).trim()) : (raw != null ? [String(raw)] : null);
      console.log('[IXC permissoes] usuário:', email, '| permitido:', permitido);
    } catch (e) { permitido = null; }
  }

  function ensureStyle() {
    if (document.getElementById('ixc-perm-style')) return;
    const st = document.createElement('style');
    st.id = 'ixc-perm-style';
    st.textContent = '.ixc-perm-hidden{display:none !important}';
    (document.head || document.documentElement).appendChild(st);
  }

  function aplicar() {
    if (!permitido) return; // acesso total
    ensureStyle();
    const set = new Set(permitido);

    // Cards liberados (a partir das chaves)
    const allow = new Set();
    set.forEach(k => { if (CARDS[k]) CARDS[k].forEach(id => allow.add(id)); });

    // Esconde via classe !important (o trocarAba do popup.js não sobrescreve)
    const tabTemCard = {};
    Object.keys(CARD_TAB).forEach(id => {
      const ok = allow.has(id);
      const body = document.getElementById('body-' + id);
      const cardEl = body ? body.closest('.card') : null;
      if (cardEl) cardEl.classList.toggle('ixc-perm-hidden', !ok);
      const tab = CARD_TAB[id];
      tabTemCard[tab] = tabTemCard[tab] || ok;
    });

    // Aba aparece só se tiver ao menos um card liberado
    document.querySelectorAll('.tab-btn[data-tab-target]').forEach(b => {
      const t = b.getAttribute('data-tab-target');
      if (t in tabTemCard) b.classList.toggle('ixc-perm-hidden', !tabTemCard[t]);
    });

    // Ações: esconde as não liberadas (com aliases amigáveis)
    ACOES.forEach(a => {
      const liberado = set.has(a) || Object.keys(ACAO_ALIAS).some(al => ACAO_ALIAS[al] === a && set.has(al));
      document.querySelectorAll('[data-action="' + a + '"]').forEach(el => el.classList.toggle('ixc-perm-hidden', !liberado));
    });

    // Se a aba ativa ficou sem cards, vai para a primeira com cards
    const ativa = document.querySelector('.tab-btn.active');
    const ativaT = ativa && ativa.getAttribute('data-tab-target');
    if (ativaT && (ativaT in tabTemCard) && !tabTemCard[ativaT]) {
      const primeira = ORDEM_ABAS.find(t => tabTemCard[t]);
      if (primeira && typeof window.trocarAba === 'function') window.trocarAba(primeira);
    }
  }

  let aplicando = false;
  async function ciclo() {
    if (aplicando) return; aplicando = true;
    try { await ensureLoaded(); aplicar(); } finally { aplicando = false; }
  }

  window.addEventListener('load', async () => {
    await ciclo();
    const alvo = document.getElementById('results');
    if (alvo) {
      const obs = new MutationObserver(() => { ciclo(); });
      obs.observe(alvo, { childList: true, subtree: true });
    }
  });
})();
