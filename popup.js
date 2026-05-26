// ═══════════════════════════════════════════════
// IXC LOOKUP — popup.js v1.6
// ═══════════════════════════════════════════════

const WEBHOOK_CONTRATO = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-lookup';
const WEBHOOK_CPF      = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-busca-cpf';
const IXC_URL          = 'https://ixc.carajasnet.com';
const WEBHOOK_ACOES    = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-desbloqueio';
const WEBHOOK_LEITURAS = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-leituras';

// ── Toggle de token (v1.6) ──
// Modo padrão na 1ª vez: master (mais seguro — não dá erro inesperado)
let modoToken = 'master'; // 'master' | 'meu'
function usarTokenMaster() { return modoToken === 'master'; }

// ── Timer de sessão (v1.6) ──
const AVISO_SESSAO_MIN = 5;       // avisa quando faltam 5min
const ESTENDER_MIN     = 30;      // botão estende para 30min completos
let timerSessao = null;
let avisoMostrado = false;

// PDF.js removido — CSP bloqueia scripts externos
// Boleto disponível apenas como download direto

// ── Histórico de consultas ────────────────────────
const MAX_HISTORICO = 5;
const HIST_KEY = 'ixc_historico_consultas';

// v1.7.6 — persiste em chrome.storage (sobrevive ao fechar do panel),
// mas Auth.clearSessao() limpa tudo no logout.
let historicoMem = []; // cache em memória pra UI rápida

async function salvarNoHistorico(contrato_id, cliente_nome, status) {
  const novo = { contrato_id, cliente_nome, status, ts: Date.now() };
  historicoMem = [novo, ...historicoMem.filter(h => h.contrato_id !== contrato_id)].slice(0, MAX_HISTORICO);
  // Persistir
  await new Promise(r => chrome.storage.local.set({ [HIST_KEY]: historicoMem }, r));
}

async function carregarHistoricoConsultas() {
  if (historicoMem.length > 0) return historicoMem;
  // Carregar do storage
  const r = await new Promise(res => chrome.storage.local.get([HIST_KEY], d => res(d[HIST_KEY] || [])));
  historicoMem = r;
  return historicoMem;
}

function renderHistorico(hist) {
  const el = document.getElementById('historico-lista');
  if (!el) return;
  if (!hist || !hist.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  // v1.7.6 — classe hist-N controla grid (1=cheio, 3=2col+1cheio, 5=2col+2col+1cheio)
  el.className = 'hist-' + hist.length;
  el.innerHTML = hist.map(h => {
    const ativo = h.status && ['Ativo'].includes(h.status);
    const cls = ativo ? 'hist-ativo' : 'hist-inativo';
    return '<button class="hist-item ' + cls + '" data-contrato="' + h.contrato_id + '" title="' + (h.cliente_nome || '') + ' — ' + (h.status || '') + '">'
      + '<span class="hist-nome">' + (h.cliente_nome || 'Contrato') + '</span>'
      + '<span class="hist-num">#' + h.contrato_id + '</span>'
      + '</button>';
  }).join('');
}

// ── Áudio de alerta (Web Audio API) ───────────
function tocarAlerta(tipo) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (tipo === 'manutencao') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.30);
      gain.gain.setValueAtTime(0.3,  ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } else if (tipo === 'financeiro') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.20);
      gain.gain.setValueAtTime(0.3,  ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.40);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.40);
    } else {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.2,  ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.20);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.20);
    }
  } catch(e) {}
}

// ── Elementos DOM ──────────────────────────────
const elInput    = document.getElementById('input-id');
const elBtn      = document.getElementById('btn-buscar');
const elIdle     = document.getElementById('state-idle');
const elLoad     = document.getElementById('state-loading');
const elError    = document.getElementById('state-error');
const elErrMsg   = document.getElementById('error-msg');
const elRes      = document.getElementById('results');
const elLast     = document.getElementById('last-query');
const elLogin    = document.getElementById('login-screen');
const elBusca    = document.getElementById('busca-area');
const elSessao   = document.getElementById('sessao-bar');
const elSessNome = document.getElementById('sessao-nome');
const elBtnLogin = document.getElementById('btn-login');
const elBtnLogout= document.getElementById('btn-logout');
const elLoginErr = document.getElementById('login-erro');

let sessaoAtual  = null;
let dadosAtual   = null; // guarda dados do contrato atual

// ── Init ───────────────────────────────────────
// v1.7.3 — sessão expira via expira_em (definido em auth.js como 4h)
async function init() {
  const sessao = await Auth.getSessao();
  if (sessao) {
    // Verificar expiração usando expira_em (timestamp ms)
    const expirado = !sessao.expira_em || sessao.expira_em <= Date.now();
    if (expirado) {
      await Auth.clearSessao();
      historicoMem = [];
      mostrarLogin();
      return;
    }
    sessaoAtual = sessao;
    mostrarApp(sessao);
  } else {
    mostrarLogin();
  }
}

function mostrarLogin() {
  elLogin.style.display = '';
  elBusca.style.display = 'none';
  elSessao.style.display = 'none';
  // v1.7.3 — esconder elementos que ficavam vazando na tela de login
  const bc = document.getElementById('cliente-ativo');
  if (bc) bc.style.display = 'none';
  const hist = document.getElementById('historico-lista');
  if (hist) hist.style.display = 'none';
  const aviso = document.getElementById('sessao-aviso');
  if (aviso) aviso.style.display = 'none';
  setState('none');
}

async function mostrarApp(sessao) {
  elLogin.style.display = 'none';
  elBusca.style.display = '';
  elSessao.style.display = '';
  elSessNome.textContent = sessao.usuario_nome;
  // Atualizar botão OLT com status de configuração
  const oltSessao = await new Promise(r=>chrome.storage.local.get(['olt_sessao'],d=>r(d.olt_sessao||null)));
  const btnOlt = document.getElementById('btn-olt-config');
  if (btnOlt) {
    if (oltSessao?.access) {
      btnOlt.textContent = '⚡ OLT ✓';
      btnOlt.style.borderColor = 'var(--g3)';
      btnOlt.style.color = 'var(--g)';
    } else {
      btnOlt.textContent = '⚡ OLT ⚠';
      btnOlt.style.borderColor = 'var(--y3)';
      btnOlt.style.color = 'var(--y)';
    }
  }
  // Botão de Gestão (uso + logs) — só para supervisores
  // v1.7.8 — fetch direto Supabase (dispensa workflow)
  {
    let ehSupervisor = false;
    try {
      const emailBusca = sessao.usuario_email || sessao.usuario_login || '';
      const SUPABASE_KEY = '';
      const supRes = await fetch(
        `https://carajasnet-supabase.bwadmr.easypanel.host/rest/v1/colaboradores_tokens?email=eq.${encodeURIComponent(emailBusca)}&select=supervisor,email`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const supData = await supRes.json();
      if (Array.isArray(supData) && supData.length > 0) {
        ehSupervisor = supData[0]?.supervisor === true;
      }
    } catch(e) {
      console.warn('[IXC] Erro supervisor:', e.message);
    }
    const btnGestao = document.getElementById('btn-gestao');
    if (btnGestao) btnGestao.style.display = ehSupervisor ? '' : 'none';
    if (ehSupervisor) sessao._supervisor = true;
  }
  // Toggle de token + timer de sessão (v1.6)
  await carregarToggleToken();
  iniciarTimerSessao();

  carregarHistoricoConsultas().then(renderHistorico);
  setState('idle');
  elInput.focus();
}

function setState(s) {
  elIdle.style.display  = s==='idle'   ? '':'none';
  elLoad.style.display  = s==='loading'? '':'none';
  elError.style.display = s==='error'  ? '':'none';
  elRes.style.display   = s==='result' ? '':'none';
  if (s==='none') { elIdle.style.display='none'; elLoad.style.display='none'; elError.style.display='none'; elRes.style.display='none'; }
}

// ── Login ──────────────────────────────────────
elBtnLogin.addEventListener('click', async () => {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!user || !pass) { elLoginErr.textContent='Preencha usuário e senha.'; elLoginErr.style.display=''; return; }
  elBtnLogin.disabled = true; elBtnLogin.textContent = 'Entrando...';
  elLoginErr.style.display = 'none';
  try {
    const sessao = await Auth.fazerLogin(user, pass);
    sessaoAtual = sessao;
    await Logger.registrarLog(sessao, 'LOGIN', {});
    mostrarApp(sessao);
    // Verificar se OLT Cloud está configurado — se não, sugerir
    const oltSessao = await new Promise(r=>chrome.storage.local.get(['olt_sessao'],d=>r(d.olt_sessao||null)));
    if (!oltSessao) {
      setTimeout(()=>{
        document.getElementById('olt-config-modal').style.display='flex';
      }, 800);
    }
  } catch(e) { elLoginErr.textContent = e.message||'Erro ao fazer login.'; elLoginErr.style.display=''; }
  finally { elBtnLogin.disabled=false; elBtnLogin.textContent='Entrar'; }
});
document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') elBtnLogin.click(); });
document.getElementById('login-user').addEventListener('keydown', e => { if(e.key==='Enter') elBtnLogin.click(); }); // v1.6

// Clique no histórico
document.addEventListener('click', e => {
  const btn = e.target.closest('.hist-item');
  if (!btn) return;
  const id = btn.getAttribute('data-contrato');
  if (id) {
    document.getElementById('input-id').value = id;
    buscar();
  }
});

elBtnLogout.addEventListener('click', async () => {
  await Logger.registrarLog(sessaoAtual, 'LOGOUT', {});
  await Auth.clearSessao(); // v1.7 — limpa todo o storage exceto tema/faixas/olt_sessao
  historicoMem = [];        // v1.7 — limpa histórico em memória
  sessaoAtual = null; dadosAtual = null;
  const bc2 = document.getElementById('cliente-ativo');
  if (bc2) bc2.style.display = 'none';
  const histEl = document.getElementById('historico-lista');
  if (histEl) histEl.style.display = 'none';
  mostrarLogin();
});

document.getElementById('btn-olt-config').addEventListener('click', async () => {
  const modal = document.getElementById('olt-config-modal');
  modal.style.display = 'flex';
  const s = await new Promise(r => chrome.storage.local.get(['olt_sessao'], d => r(d.olt_sessao||null)));
  if (s?.username) document.getElementById('olt-user').value = s.username;
});
document.getElementById('olt-config-cancel').addEventListener('click', () => { document.getElementById('olt-config-modal').style.display='none'; });

// ── Logs (aba dentro de Gestão) ───────────────────────
let logsCache = [];        // últimos logs buscados (p/ exportar PDF)
let logsFiltroCache = '';  // descrição do filtro aplicado
document.getElementById('logs-buscar').addEventListener('click', async () => {
  const cpf     = document.getElementById('logs-filtro-cpf').value.trim();
  const usuario = document.getElementById('logs-filtro-usuario').value.trim();
  const resEl   = document.getElementById('logs-resultado');
  resEl.innerHTML = '<div style="color:var(--tx2)">⏳ Buscando...</div>';

  try {
    // v1.7.8 — voltou ao fetch direto Supabase (v1.5) — mais simples, dispensa workflow
    const SUPABASE_KEY = '';
    const baseUrl = 'https://carajasnet-supabase.bwadmr.easypanel.host/rest/v1/ixc_logs';

    const params = new URLSearchParams();
    params.set('order', 'criado_em.desc');
    params.set('limit', '50');

    if (cpf && usuario) {
      params.set('contrato_id',   `eq.${cpf}`);
      params.set('usuario_login', `ilike.*${usuario}*`);
    } else if (cpf) {
      // OR: contrato_id OU cliente_id
      params.set('or', `(contrato_id.eq.${cpf},cliente_id.eq.${cpf})`);
    } else if (usuario) {
      params.set('usuario_login', `ilike.*${usuario}*`);
    }

    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const logs = await res.json();
    logsCache = Array.isArray(logs) ? logs : [];
    logsFiltroCache = [cpf && ('contrato/cliente: '+cpf), usuario && ('colaborador: '+usuario)].filter(Boolean).join(' · ') || 'sem filtro';

    if (!logs?.length) {
      resEl.innerHTML = '<div class="empty">Nenhum log encontrado.</div>';
      return;
    }

    const ACAO_COR = {
      'LOGIN':'azul','LOGOUT':'cinza','CONSULTA_CONTRATO':'azul',
      'CONSULTA_CPF':'azul','DESBLOQUEIO_CONFIANCA':'amarelo','DESCONEXAO_LOGIN':'amarelo'
    };
    const ACAO_ICON = {
      'LOGIN':'🔑','LOGOUT':'🚪','CONSULTA_CONTRATO':'🔍',
      'CONSULTA_CPF':'🔍','DESBLOQUEIO_CONFIANCA':'🔓','DESCONEXAO_LOGIN':'⚡'
    };

    resEl.innerHTML = logs.map(l => {
      const cor  = ACAO_COR[l.acao] || 'cinza';
      const icon = ACAO_ICON[l.acao] || '•';
      const dt   = new Date(l.criado_em).toLocaleString('pt-BR');
      const det  = l.detalhes ? (typeof l.detalhes === 'string' ? JSON.parse(l.detalhes) : l.detalhes) : {};
      const detTxt = Object.entries(det).map(([k,v])=>`${k}: ${v}`).join(' | ');
      return `<div style="border:1px solid var(--b);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:5px;background:var(--bg3)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="badge ${cor}">${icon} ${l.acao}</span>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--tx2)">${dt}</span>
          ${l.sucesso?'':'<span class="badge vermelho">FALHOU</span>'}
        </div>
        <div style="font-size:11px;color:var(--tx);font-weight:600">${l.usuario_nome} (${l.usuario_login})</div>
        ${l.cliente_nome?`<div style="font-size:11px;color:var(--tx2)">Cliente: ${l.cliente_nome} — Contrato: #${l.contrato_id||'—'}</div>`:''}
        ${detTxt?`<div style="font-size:10px;color:var(--tx3);margin-top:2px;font-family:var(--font-mono)">${detTxt}</div>`:''}
        ${l.erro?`<div style="font-size:10px;color:var(--r);margin-top:2px">Erro: ${l.erro}</div>`:''}
      </div>`;
    }).join('');

  } catch(e) {
    resEl.innerHTML = `<div style="color:var(--r)">Erro ao buscar logs: ${e.message}</div>`;
  }
});

// ── Gestão de Uso (supervisor) ─────────────────────────
const GESTAO_KEY = '';
const GESTAO_LOGS_URL = 'https://carajasnet-supabase.bwadmr.easypanel.host/rest/v1/ixc_logs';

let gestaoAbaAtiva = 'uso';
let gestaoPeriodoAtivo = '7';
let gestaoAgregadoCache = null; // { ag, periodo } — p/ exportar PDF

(function initGestao(){
  const btnG = document.getElementById('btn-gestao');
  if (btnG) btnG.addEventListener('click', () => {
    document.getElementById('gestao-modal').style.display = 'flex';
    setGestaoAba('uso');
    setGestaoPeriodo('7');
  });
  const fecharG = document.getElementById('gestao-fechar');
  if (fecharG) fecharG.addEventListener('click', () => {
    document.getElementById('gestao-modal').style.display = 'none';
  });
  document.querySelectorAll('.gestao-periodo').forEach(b => {
    b.addEventListener('click', () => setGestaoPeriodo(b.dataset.periodo));
  });
  document.querySelectorAll('.gestao-tab').forEach(b => {
    b.addEventListener('click', () => setGestaoAba(b.dataset.gtab));
  });
  const btnPdf = document.getElementById('gestao-pdf');
  if (btnPdf) btnPdf.addEventListener('click', exportarRelatorioPDF);
})();

function setGestaoAba(aba) {
  gestaoAbaAtiva = aba;
  document.querySelectorAll('.gestao-tab').forEach(b => b.classList.toggle('ativa', b.dataset.gtab === aba));
  const uso  = document.getElementById('gtab-uso');
  const logs = document.getElementById('gtab-logs');
  if (uso)  uso.style.display  = aba === 'uso'  ? '' : 'none';
  if (logs) logs.style.display = aba === 'logs' ? '' : 'none';
}

function setGestaoPeriodo(p) {
  gestaoPeriodoAtivo = p;
  document.querySelectorAll('.gestao-periodo').forEach(b => {
    const ativo = b.dataset.periodo === p;
    b.classList.toggle('btn-blue', ativo);
    b.classList.toggle('btn-gray', !ativo);
  });
  carregarGestao(p);
}

function gestaoPeriodoLabel(p) {
  return p === 'hoje' ? 'Hoje' : (p === '30' ? 'Últimos 30 dias' : 'Últimos 7 dias');
}

function gestaoSinceISO(p) {
  if (p === 'hoje') { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }
  const dias = p === '30' ? 30 : 7;
  return new Date(Date.now() - dias*86400000).toISOString();
}

async function carregarGestao(periodo) {
  const el = document.getElementById('gestao-resultado');
  if (!el) return;
  el.innerHTML = '⏳ Carregando...';
  try {
    const since = gestaoSinceISO(periodo);
    const headers = { apikey: GESTAO_KEY, Authorization: `Bearer ${GESTAO_KEY}` };
    const sel = 'usuario_login,usuario_nome,usuario_id,acao,sucesso,criado_em';
    const mkUrl = comVer => `${GESTAO_LOGS_URL}?select=${sel}${comVer?',extensao_versao':''}&criado_em=gte.${since}&order=criado_em.desc&limit=10000`;
    let res = await fetch(mkUrl(true), { headers });
    if (!res.ok) res = await fetch(mkUrl(false), { headers }); // coluna extensao_versao pode não existir ainda
    const logs = await res.json();
    if (!Array.isArray(logs) || !logs.length) { gestaoAgregadoCache = null; el.innerHTML = '<div class="empty">Nenhuma atividade no período.</div>'; return; }
    const ag = agregarGestao(logs);
    gestaoAgregadoCache = { ag, periodo };
    el.innerHTML = renderGestao(ag);
  } catch(e) {
    el.innerHTML = `<div style="color:var(--r)">Erro ao carregar gestão: ${e.message}</div>`;
  }
}

function agregarGestao(logs) {
  const AGORA = Date.now();
  const SESSAO_MS = 4*3600*1000;
  const NAO_ACAO = new Set(['LOGIN','LOGOUT']);
  const users = {};
  logs.forEach(l => {
    const key = l.usuario_login || l.usuario_nome || ('id'+l.usuario_id) || '—';
    if (!users[key]) users[key] = { login:key, nome:l.usuario_nome||key, total:0, acoes:0, falhas:0, byAcao:{}, ultimo:null, ultimaAcao:null, versao:null };
    const u = users[key];
    u.byAcao[l.acao] = (u.byAcao[l.acao]||0)+1;
    u.total++;
    if (!NAO_ACAO.has(l.acao)) u.acoes++;
    if (l.sucesso === false) u.falhas++;
    const t = new Date(l.criado_em).getTime();
    if (u.ultimo===null || t>u.ultimo) { u.ultimo=t; u.ultimaAcao=l.acao; }
    if (!u.versao && l.extensao_versao) u.versao = l.extensao_versao; // logs DESC → 1º não-nulo = mais recente
  });
  const lista = Object.values(users);
  const totalAcoes = lista.reduce((s,u)=>s+u.acoes,0);
  const ativos  = lista.filter(u => (AGORA-u.ultimo) < SESSAO_MS && u.ultimaAcao!=='LOGOUT');
  const ociosos = lista.filter(u => (u.byAcao['LOGIN']||0)>0 && u.acoes<=1);
  return { AGORA, lista, totalAcoes, ativos, ociosos };
}

function renderGestao(ag) {
  const { AGORA, lista, totalAcoes, ativos, ociosos } = ag;
  const GROW = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--b);font-size:11px;color:var(--tx)';
  const tempoRel = ms => { if(!ms) return '—'; const m=Math.floor((AGORA-ms)/60000); if(m<1)return 'agora'; if(m<60)return m+'min atrás'; const h=Math.floor(m/60); if(h<24)return h+'h atrás'; return Math.floor(h/24)+'d atrás'; };
  const consultas = u => (u.byAcao['CONSULTA_CONTRATO']||0)+(u.byAcao['CONSULTA_CPF']||0);

  let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    ${cardGestao('Colaboradores', lista.length, 'acc')}
    ${cardGestao('Ações no período', totalAcoes, 'acc')}
    ${cardGestao('Ativos agora', ativos.length, ativos.length?'g':'tx2')}
    ${cardGestao('Ociosos', ociosos.length, ociosos.length?'y':'tx2')}
  </div>`;

  html += secaoGestao('🟢 Ativos agora <span style="font-weight:400;color:var(--tx3);font-size:10px">(login nas últimas 4h, sem logout)</span>', ativos.length
    ? ativos.sort((a,b)=>b.ultimo-a.ultimo).map(u=>`<div style="${GROW}"><span>${u.nome}</span><span style="color:var(--g)">${tempoRel(u.ultimo)} · ${u.acoes} ação(ões)</span></div>`).join('')
    : '<div style="color:var(--tx3);font-size:11px">Ninguém ativo na janela de sessão.</div>');

  const ranking = [...lista].sort((a,b)=>b.acoes-a.acoes).slice(0,15);
  const maxR = ranking[0]?.acoes || 1;
  html += secaoGestao('🏆 Ranking de uso', ranking.map((u,i)=>{
    const pct = Math.round((u.acoes/maxR)*100);
    return `<div style="${GROW}"><span>${i+1}. ${u.nome}</span><span style="display:flex;align-items:center;gap:6px"><span style="width:60px;height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;display:inline-block"><span style="display:block;height:100%;width:${pct}%;background:var(--acc)"></span></span><strong>${u.acoes}</strong></span></div>`;
  }).join(''));

  html += secaoGestao('💤 Logados sem (quase) atividade', ociosos.length
    ? ociosos.sort((a,b)=>(b.byAcao['LOGIN']||0)-(a.byAcao['LOGIN']||0)).map(u=>`<div style="${GROW}"><span>${u.nome}</span><span style="color:var(--tx3)">${u.byAcao['LOGIN']||0} login(s) · ${u.acoes} ação(ões)</span></div>`).join('')
    : '<div style="color:var(--tx3);font-size:11px">Nenhum colaborador ocioso.</div>');

  const linhas = [...lista].sort((a,b)=>b.acoes-a.acoes).map(u=>`<tr style="border-bottom:1px solid var(--b)">
    <td style="padding:4px 6px">${u.nome}</td>
    <td style="text-align:center">${u.versao?('v'+u.versao):'—'}</td>
    <td style="text-align:center">${consultas(u)}</td>
    <td style="text-align:center">${u.byAcao['DESBLOQUEIO_CONFIANCA']||0}</td>
    <td style="text-align:center">${u.byAcao['ENVIAR_BOLETO_EMAIL']||0}</td>
    <td style="text-align:center">${u.byAcao['AGENDAR_OS']||0}</td>
    <td style="text-align:center;color:${u.falhas?'var(--r)':'var(--tx3)'}">${u.falhas}</td>
    <td style="font-size:9px;color:var(--tx3)">${tempoRel(u.ultimo)}</td>
  </tr>`).join('');
  html += secaoGestao('👤 Por colaborador', `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:10px;color:var(--tx)">
    <thead><tr style="color:var(--tx3);text-align:left">
      <th style="padding:4px 6px">Colaborador</th><th style="text-align:center">Versão</th><th style="text-align:center" title="Consultas (contrato + CPF)">🔍</th><th style="text-align:center" title="Desbloqueios">🔓</th><th style="text-align:center" title="Boletos por e-mail">✉</th><th style="text-align:center" title="OS agendadas">🛠</th><th style="text-align:center" title="Falhas">⚠</th><th>Último acesso</th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`);

  return html;
}

function cardGestao(label, val, cor) {
  return `<div style="flex:1;min-width:110px;background:var(--bg3);border:1px solid var(--b);border-radius:var(--radius-sm);padding:8px 10px">
    <div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">${label}</div>
    <div style="font-size:20px;font-weight:700;color:var(--${cor})">${val}</div>
  </div>`;
}
function secaoGestao(titulo, conteudo) {
  return `<div style="margin-bottom:16px">
    <div style="font-family:var(--font-head);font-size:12px;font-weight:700;color:var(--tx);margin-bottom:6px">${titulo}</div>
    ${conteudo}
  </div>`;
}

// ── Exportar relatório em PDF ─────────────────────────
// Abre uma página da extensão (relatorio.html) que imprime → "Salvar como PDF".
// Feito assim (e não inline) por causa da CSP da extensão.
function escPdf(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function abrirRelatorioPDF(titulo, corpoHtml) {
  chrome.storage.local.set({ ixc_relatorio: { titulo, corpoHtml, ts: Date.now() } }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('relatorio.html') });
  });
}

function exportarRelatorioPDF() {
  if (gestaoAbaAtiva === 'logs') exportarLogsPDF();
  else exportarUsoPDF();
}

function exportarUsoPDF() {
  if (!gestaoAgregadoCache) { toast('Nada para exportar — carregue a aba Uso primeiro.','err'); return; }
  const { ag, periodo } = gestaoAgregadoCache;
  const { lista, totalAcoes, ativos, ociosos, AGORA } = ag;
  const tempoRel = ms => { if(!ms) return '—'; const m=Math.floor((AGORA-ms)/60000); if(m<1)return 'agora'; if(m<60)return m+'min atrás'; const h=Math.floor(m/60); if(h<24)return h+'h atrás'; return Math.floor(h/24)+'d atrás'; };
  const consultas = u => (u.byAcao['CONSULTA_CONTRATO']||0)+(u.byAcao['CONSULTA_CPF']||0);
  const subtitulo = 'font-weight:400;color:#666;font-size:11px';
  const ranking = [...lista].sort((a,b)=>b.acoes-a.acoes);

  const linhasColab = ranking.map((u,i)=>`<tr>
    <td class="tcenter">${i+1}</td><td>${escPdf(u.nome)}</td>
    <td class="tcenter">${u.versao?('v'+escPdf(u.versao)):'—'}</td>
    <td class="tcenter">${u.acoes}</td>
    <td class="tcenter">${consultas(u)}</td>
    <td class="tcenter">${u.byAcao['DESBLOQUEIO_CONFIANCA']||0}</td>
    <td class="tcenter">${u.byAcao['ENVIAR_BOLETO_EMAIL']||0}</td>
    <td class="tcenter">${u.byAcao['AGENDAR_OS']||0}</td>
    <td class="tcenter ${u.falhas?'err':''}">${u.falhas}</td>
    <td>${tempoRel(u.ultimo)}</td>
  </tr>`).join('');

  const linhasAtivos = ativos.length
    ? ativos.sort((a,b)=>b.ultimo-a.ultimo).map(u=>`<tr><td>${escPdf(u.nome)}</td><td>${tempoRel(u.ultimo)}</td><td class="tcenter">${u.acoes}</td></tr>`).join('')
    : `<tr><td colspan="3">Ninguém ativo na janela de sessão (4h).</td></tr>`;

  const linhasRanking = ranking.map((u,i)=>`<tr><td class="tcenter">${i+1}</td><td>${escPdf(u.nome)}</td><td class="tcenter">${u.acoes}</td></tr>`).join('');

  const ociososOrd = [...ociosos].sort((a,b)=>(b.byAcao['LOGIN']||0)-(a.byAcao['LOGIN']||0));
  const linhasOciosos = ociososOrd.length
    ? ociososOrd.map(u=>`<tr><td>${escPdf(u.nome)}</td><td class="tcenter">${u.byAcao['LOGIN']||0}</td><td class="tcenter">${u.acoes}</td></tr>`).join('')
    : `<tr><td colspan="3">Nenhum colaborador ocioso.</td></tr>`;

  const corpo = `
    <h1>Relatório de Uso — IXC Lookup</h1>
    <div class="muted">Período: ${escPdf(gestaoPeriodoLabel(periodo))} · Gerado em ${new Date().toLocaleString('pt-BR')}</div>

    <h2>Resumo</h2>
    <table><thead><tr><th>Colaboradores</th><th>Ações no período</th><th>Ativos agora</th><th>Ociosos</th></tr></thead>
    <tbody><tr><td class="tcenter">${lista.length}</td><td class="tcenter">${totalAcoes}</td><td class="tcenter">${ativos.length}</td><td class="tcenter">${ociosos.length}</td></tr></tbody></table>

    <h2>🟢 Ativos agora <span style="${subtitulo}">(login nas últimas 4h, sem logout)</span></h2>
    <table><thead><tr><th>Colaborador</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>${linhasAtivos}</tbody></table>

    <h2>🏆 Ranking de uso</h2>
    <table><thead><tr><th>#</th><th>Colaborador</th><th>Ações</th></tr></thead><tbody>${linhasRanking}</tbody></table>

    <h2>💤 Logados sem (quase) atividade</h2>
    <table><thead><tr><th>Colaborador</th><th>Logins</th><th>Ações</th></tr></thead><tbody>${linhasOciosos}</tbody></table>

    <h2>👤 Por colaborador</h2>
    <table><thead><tr><th>#</th><th>Colaborador</th><th>Versão</th><th>Ações</th><th>Consultas</th><th>Desbloq.</th><th>Boletos</th><th>OS</th><th>Falhas</th><th>Último acesso</th></tr></thead>
    <tbody>${linhasColab}</tbody></table>`;
  abrirRelatorioPDF('Relatório de Uso — IXC Lookup', corpo);
}

function exportarLogsPDF() {
  if (!logsCache.length) { toast('Busque os logs antes de exportar.','err'); return; }
  const linhas = logsCache.map(l=>{
    const det = l.detalhes ? (typeof l.detalhes==='string'? l.detalhes : JSON.stringify(l.detalhes)) : '';
    return `<tr>
      <td>${new Date(l.criado_em).toLocaleString('pt-BR')}</td>
      <td>${escPdf(l.usuario_nome)} (${escPdf(l.usuario_login)})</td>
      <td>${escPdf(l.acao)}</td>
      <td>${escPdf(l.cliente_nome||'')}${l.contrato_id?(' #'+escPdf(l.contrato_id)):''}</td>
      <td class="${l.sucesso===false?'err':'ok'}">${l.sucesso===false?'FALHOU':'OK'}</td>
      <td>${escPdf(det)}${l.erro?(' | erro: '+escPdf(l.erro)):''}</td>
    </tr>`;
  }).join('');
  const corpo = `
    <h1>Relatório de Logs — IXC Lookup</h1>
    <div class="muted">Filtro: ${escPdf(logsFiltroCache||'sem filtro')} · ${logsCache.length} registro(s) · Gerado em ${new Date().toLocaleString('pt-BR')}</div>
    <table><thead><tr><th>Data/Hora</th><th>Colaborador</th><th>Ação</th><th>Cliente / Contrato</th><th>Status</th><th>Detalhes</th></tr></thead>
    <tbody>${linhas}</tbody></table>`;
  abrirRelatorioPDF('Relatório de Logs — IXC Lookup', corpo);
}

// ── Sinal OLT (somente informativo — faixas padrão fixas para todos) ──
document.getElementById('btn-config').addEventListener('click', () => {
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
  set('cfg-sinal-verde', CFG_SINAL.verde);
  set('cfg-sinal-amarelo', CFG_SINAL.amarelo);
  set('cfg-temp-amarelo', CFG_SINAL.tempAmarelo);
  set('cfg-temp-vermelho', CFG_SINAL.tempVermelho);
  document.getElementById('config-modal').style.display = 'flex';
});
document.getElementById('cfg-cancelar').addEventListener('click', ()=>{
  document.getElementById('config-modal').style.display='none';
});

// ── Tema claro/escuro ─────────────────────────────────
document.getElementById('btn-tema').addEventListener('click', async () => {
  const atual = document.documentElement.getAttribute('data-tema')||'escuro';
  const novo  = atual==='claro'?'escuro':'claro';
  document.documentElement.setAttribute('data-tema', novo);
  document.getElementById('btn-tema').textContent = novo==='claro'?'🌙':'☀';
  await new Promise(r=>chrome.storage.local.set({tema:novo},r));
});
document.getElementById('olt-config-save').addEventListener('click', async () => {
  const user = document.getElementById('olt-user').value.trim();
  const pass = document.getElementById('olt-pass').value;
  const erro = document.getElementById('olt-config-erro');
  if (!user||!pass) { erro.textContent='Preencha e-mail e senha.'; erro.style.display=''; return; }
  erro.style.display='none';
  document.getElementById('olt-config-save').textContent='Verificando...';
  try {
    const res = await fetch('https://carajas.oltcloud.co/api/token', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:user,password:pass})
    });
    if (!res.ok) throw new Error('Credenciais inválidas');
    const data = await res.json();
    if (!data.access) throw new Error('Token não retornado');
    await new Promise(r => chrome.storage.local.set({olt_sessao:{username:user,password:pass,access:data.access,refresh:data.refresh}},r));
    document.getElementById('olt-config-modal').style.display='none';
    toast('OLT Cloud configurado!','ok');
    // Atualizar botão
    const btnOlt2 = document.getElementById('btn-olt-config');
    if (btnOlt2) { btnOlt2.textContent='⚡ OLT ✓'; btnOlt2.style.borderColor='var(--g3)'; btnOlt2.style.color='var(--g)'; }
  } catch(e) { erro.textContent=e.message||'Erro ao conectar'; erro.style.display=''; }
  finally { document.getElementById('olt-config-save').textContent='Salvar'; }
});

// ── Event Delegation ───────────────────────────
document.addEventListener('click', e => {
  // v1.7.5 — troca de aba
  const tabBtn = e.target.closest('[data-tab-target]');
  if (tabBtn) { trocarAba(tabBtn.getAttribute('data-tab-target')); return; }

  const h = e.target.closest('[data-toggle]');
  if (h) { toggle(h.getAttribute('data-toggle')); return; }
  const cc = e.target.closest('[data-contrato-id]');
  if (cc) { selecionarContrato(cc.getAttribute('data-contrato-id')); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const p  = btn.getAttribute('data-p') ||'';
  const p2 = btn.getAttribute('data-p2')||'';
  const p3 = btn.getAttribute('data-p3')||'';
  if (action==='copy')        copiarSecao(p);
  if (action==='copiar-tudo') copiarTudo();
  if (action==='atualizar-cache') buscarContrato(p, true);
  if (action==='boleto')      carregarBoleto(p, p2);
  if (action==='link')        abrirLink(p);
  if (action==='whatsapp')    abrirWhatsApp(p);
  if (action==='roteador')    abrirRoteador(p,p2);
  if (action==='desbloquear') desbloquearConfianca(p,p2);
  if (action==='desconectar') desconectarLogin(p,p2,p3);
  if (action==='reboot-onu')  rebootONU(p,p2,p3);
  if (action==='pix')         copiarPIX(p);
  if (action==='enviar-boleto-email') enviarBoletoEmail(p, p2);
  if (action==='abrir-agendar')       abrirAgendarOS(p, p2);
  if (action==='potencia-onu')        consultarPotenciaONU(p, p2);
});

// Mostrar/ocultar senha
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-show-pass');
  if (!btn) return;
  const targetId = btn.getAttribute('data-target');
  const input = document.getElementById(targetId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
});

function toggle(id) {
  let b = document.querySelector(`[data-item-id="body-${id}"]`)||document.getElementById('body-'+id);
  const c = document.getElementById('chev-'+id);
  if (!b) return;
  const open = !b.classList.contains('collapsed');
  b.classList.toggle('collapsed',open);
  if (c) c.classList.toggle('open',!open);
}

// v1.7.5 — troca de aba ativa + lazy-load on-demand
let abaAtual = 'geral';
function trocarAba(tab) {
  if (!tab || tab === abaAtual) return;
  abaAtual = tab;
  // Atualiza estado visual dos botões
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab-target') === tab);
  });
  // Mostra/esconde cards conforme aba
  document.querySelectorAll('.card[data-tab]').forEach(c => {
    c.style.display = c.getAttribute('data-tab') === tab ? '' : 'none';
  });
  // Lazy-load: dispara carregamento das seções pesadas só quando a aba é aberta
  // (mantém comportamento original que era ao clicar no card)
  if (tab === 'atendimento') triggerLazyByCardId('tickets');
  if (tab === 'historicos')  { triggerLazyByCardId('hist-contrato'); triggerLazyByCardId('negociacoes'); }
  if (tab === 'servicos')    { triggerLazyByCardId('produtos-contrato'); triggerLazyByCardId('tv-sva'); }
}

// Helper — dispara o lazy-load do card pela aba (não precisa de clique no placeholder)
async function triggerLazyByCardId(cardId) {
  const body = document.getElementById('body-' + cardId);
  if (!body) return;
  if (body.dataset.loaded === 'true') return;

  // Encontra o elemento placeholder .lazy-load dentro do body
  const lazy = body.querySelector('.lazy-load');
  if (!lazy) { body.dataset.loaded = 'true'; return; }

  // Abre o card automaticamente para o usuário ver o carregamento
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    const chev = document.getElementById('chev-' + cardId);
    if (chev) chev.classList.add('open');
  }

  // Marca como carregado antes de chamar (evita disparo duplo)
  body.dataset.loaded = 'true';

  const tipo = lazy.getAttribute('data-load');
  lazy.textContent = '⏳ Carregando...';
  try {
    if (tipo === 'tickets')     await carregarTickets(lazy);
    if (tipo === 'historico')   await carregarHistoricoContrato(lazy);
    if (tipo === 'negociacoes') await carregarNegociacoes(lazy);
    if (tipo === 'produtos')    await carregarProdutos(lazy);
    if (tipo === 'tvsva')       await carregarTVSVA(lazy);
  } catch(e) {
    console.error('Lazy load erro:', tipo, e);
    if (lazy.parentElement) lazy.innerHTML = `❌ Erro: ${e.message}`;
    body.dataset.loaded = 'false'; // permite tentar de novo
  }
}

// ── Helpers ────────────────────────────────────
function bc(v) {
  if (!v) return 'cinza';
  const s=(v||'').toLowerCase();
  if (['ativo','online','finalizada','pago','quitado','disponível'].some(x=>s===x||s.startsWith(x+' '))) return 'verde';
  if (['inativo','negativad','desistiu','suspenso','vencido','indisponível','loss','sem energia'].some(x=>s.includes(x))) return 'vermelho';
  if (['pré','pendente','aberta','offline','análise','encaminhada','assumida','agendada','deslocamento','execução','aguard'].some(x=>s.includes(x))) return 'amarelo';
  return 'cinza';
}
function bcSLA(s){const v=(s||'N').toString().toUpperCase();if(v==='N')return 'azul';if(v==='A')return 'vermelho';if(v==='C')return 'roxo';return 'cinza';}
function slaLabel(s){const v=(s||'N').toString().toUpperCase();if(v==='N')return 'No prazo';if(v==='A')return 'Atrasado';if(v==='C')return 'Crítico';return 'SLA '+s;}
// Legenda de cores das faturas (IXC): a receber em dia/hoje/vencido, recebido em dia/atraso, cancelado, renegociado
function statusFatura(t){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const venc = t.vencimento ? new Date((''+t.vencimento).slice(0,10)+'T00:00:00') : null;
  const vencOk = venc && !isNaN(venc.getTime());
  if (t.renegociado) return {label:'Renegociado', cor:'roxo'};
  if (t.cancelado)   return {label:'Cancelado', cor:'cinza'};
  if (t.status === 'A') {
    if (vencOk) {
      if (venc.getTime() === hoje.getTime()) return {label:'Vence hoje', cor:'amarelo'};
      if (venc < hoje) return {label:'Vencido', cor:'vermelho'};
    }
    return {label:'A receber', cor:'azul'};
  }
  const baixa = t.data_baixa ? new Date((''+t.data_baixa).slice(0,10)+'T00:00:00') : null;
  if (baixa && vencOk && !isNaN(baixa.getTime()) && baixa > venc) return {label:'Recebido em atraso', cor:'verde-esc'};
  return {label:'Recebido', cor:'verde'};
}
function badge(v,cls){if(!v)return '';return `<span class="badge ${cls||bc(v)}">${v}</span>`;}
function fmt(dt){if(!dt||dt.startsWith('0000')||dt===''||dt==='0000-00-00 00:00:00')return null;return dt.replace('T',' ').substring(0,16);}
function row(k,v,cls){if(!v&&v!==0)return '';const val=cls?badge(v,cls):`<span class="row-val">${v}</span>`;return `<div class="row"><span class="row-key">${k}</span>${val}</div>`;}
function mrow(k,v,cls){if(!v&&v!==0)return '';const val=cls?badge(v,cls):v;return `<div class="meta-row"><span class="meta-key">${k}</span><span class="meta-val">${val}</span></div>`;}
function infoBox(t,txt,cls){if(!txt)return '';return `<div class="info-box ${cls||''}"><strong>${t}</strong>${txt}</div>`;}
function secT(t){return `<div class="sec-title">${t}</div>`;}
function fmtOLT(v,dec,unit){if(v==null)return '—';const n=parseFloat(v);if(isNaN(n))return '—';return n.toFixed(dec)+(unit||'');}
// Faixas de sinal/temperatura — PADRÃO FIXO para todos (somente informativo, sem edição)
const CFG_SINAL = { verde:-18, amarelo:-20, tempAmarelo:60, tempVermelho:75 };

function sinalCls(v){
  const s=parseFloat(v); if(isNaN(s))return 'cinza';
  if(s>=CFG_SINAL.verde)  return 'verde';
  if(s>=CFG_SINAL.amarelo)return 'amarelo';
  return 'vermelho';
}
function tempCls(v){
  const t=parseFloat(v); if(isNaN(t))return 'cinza';
  if(t>CFG_SINAL.tempVermelho)return 'vermelho';
  if(t>CFG_SINAL.tempAmarelo) return 'amarelo';
  return 'verde';
}

function copiarTudo() {
  const d = dadosAtual;
  if (!d) return;
  const c = d.contrato, cl = d.cliente, fin = d.financeiro;
  const sep = '\n';
  const L = [];

  L.push('==============================');
  L.push('Cliente: ' + cl.nome);
  L.push('CPF/CNPJ: ' + (cl.cpf||'---'));
  L.push('==============================');

  L.push('');
  L.push('-- CONTRATO --');
  L.push('N contrato: ' + c.numero);
  L.push('Status: ' + c.status);
  L.push('Status acesso: ' + (c.status_acesso||'---'));
  L.push('Plano: ' + (c.plano||'---'));
  L.push('Velocidade: ' + (c.velocidade||'---'));
  L.push('Vencimento: ' + (c.vencimento||'---'));
  if (c.mensalidade) L.push('Mensalidade: R$ ' + c.mensalidade);
  if (c.pago_ate) L.push('Pago até: ' + c.pago_ate);
  if (c.data_ativacao) L.push('Ativação: ' + c.data_ativacao);
  if (c.data_renovacao) L.push('Última renovação: ' + c.data_renovacao);
  if (c.data_expiracao) L.push('Expiração: ' + c.data_expiracao);
  if (c.fidelidade) L.push('Fidelidade: ' + c.fidelidade + ' meses');
  if (c.desbloqueio_conf) L.push('Desbl. conf.: ' + c.desbloqueio_conf);

  if ((d.acrescimos && d.acrescimos.length) || (d.descontos && d.descontos.length)) {
    L.push('');
    L.push('-- ACRÉSCIMOS / DESCONTOS --');
    (d.acrescimos||[]).forEach(function(x){ L.push('Acréscimo: + R$ ' + (x.valor||'-') + (x.descricao?' - '+x.descricao:'')); });
    (d.descontos||[]).forEach(function(x){ L.push('Desconto: - R$ ' + (x.valor||'-') + (x.descricao?' - '+x.descricao:'')); });
  }

  L.push('');
  L.push('-- CLIENTE --');
  if (cl.whatsapp||cl.celular) L.push('WhatsApp/Cel: ' + (cl.whatsapp||cl.celular));
  if (cl.telefone) L.push('Telefone: ' + cl.telefone);
  if (cl.email)    L.push('E-mail: ' + cl.email);
  if (cl.endereco) L.push('Endereco: ' + cl.endereco);

  if (d.logins && d.logins.length) {
    L.push('');
    L.push('-- LOGINS PPPoE --');
    d.logins.forEach(function(l) {
      L.push('Login: ' + l.login);
      L.push('  Status: ' + (l.status_acesso||l.online||'---'));
      L.push('  IP: ' + (l.ip||'---'));
      if (l.mac) L.push('  MAC: ' + l.mac);
    });
  }

  if (fin && fin.titulos && fin.titulos.length) {
    L.push('');
    L.push('-- FINANCEIRO --');
    var SF = {A:'Em aberto',C:'Pago',B:'Baixado',P:'Pago parcial'};
    fin.titulos.forEach(function(t) {
      var vencido = t.status==='A' && new Date(t.vencimento) < new Date();
      L.push('Titulo: R$ ' + t.valor + ' - Venc: ' + t.vencimento + ' - ' + (vencido?'VENCIDO':(SF[t.status]||t.status)));
    });
  }

  if (d.os_abertas && d.os_abertas.length) {
    L.push('');
    L.push('-- OS ABERTAS --');
    d.os_abertas.forEach(function(o) {
      L.push('OS #' + o.id + ': ' + (o.assunto||'---') + ' [' + (o.status||'---') + ']');
    });
  }

  if (d.os_encerradas && d.os_encerradas.length) {
    L.push('');
    L.push('-- OS ENCERRADAS --');
    d.os_encerradas.forEach(function(o) {
      L.push('OS #' + o.id + ': ' + (o.assunto||'---') + ' [' + (o.status||'---') + ']');
    });
  }

  if (d.comodatos && d.comodatos.length) {
    L.push('');
    L.push('-- COMODATOS --');
    d.comodatos.forEach(function(co) {
      L.push((co.produto||co.nome_produto||'Equip.') + ' - Serial: ' + (co.serial||'---') + ' - MAC: ' + (co.mac||'---'));
    });
  }

  // OLT Cloud
  var oltCloud = d._olt_cloud || {};
  var oltEntries = Object.values(oltCloud).filter(function(o) { return o && o.sinal_onu != null; });
  if (oltEntries.length) {
    L.push('');
    L.push('-- OLT CLOUD --');
    oltEntries.forEach(function(olt) {
      if (olt.serial)     L.push('Serial ONU: ' + olt.serial);
      if (olt.modelo)     L.push('Modelo: ' + olt.modelo);
      if (olt.olt)        L.push('OLT: ' + olt.olt);
      if (olt.slot_pon_onu) L.push('Slot/PON/ONU: ' + olt.slot_pon_onu);
      if (olt.sinal_onu != null) L.push('RX ONU: ' + parseFloat(olt.sinal_onu).toFixed(2) + ' dBm');
      if (olt.sinal_olt != null) L.push('RX OLT: ' + parseFloat(olt.sinal_olt).toFixed(2) + ' dBm');
      if (olt.temperatura != null) L.push('Temperatura: ' + parseFloat(olt.temperatura).toFixed(1) + 'C');
      if (olt.tensao != null)      L.push('Tensao: ' + parseFloat(olt.tensao).toFixed(2) + ' V');
      if (olt.uptime)              L.push('Uptime: ' + olt.uptime);
      if (olt.status)              L.push('Status OLT: ' + olt.status);
    });
  }

  L.push('');
  L.push('==============================');

  navigator.clipboard.writeText(L.join(sep)).then(function() {
    toast('Tudo copiado!', 'ok');
  }).catch(function() {
    toast('Erro ao copiar', 'err');
  });
}

async function copiarSecao(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const linhas = [];
  el.querySelectorAll('.meta-row,.row,.olt-item,.olt-alarme').forEach(r => {
    const k = r.querySelector('.meta-key,.row-key,.olt-label');
    const v = r.querySelector('.meta-val,.row-val,.olt-val');
    if (k && v) linhas.push(k.innerText.trim() + ': ' + v.innerText.trim());
    else linhas.push(r.innerText.trim());
  });
  const txt = linhas.filter(Boolean).join('\n') || el.innerText.trim();
  try { await navigator.clipboard.writeText(txt); toast('Copiado!','ok'); }
  catch(e) { toast('Erro ao copiar','err'); }
};

function secTCopy(titulo, copyId) {
  return '<div class="sec-title">' + titulo + '</div>';
}

function toast(msg,tipo) {
  const t=document.createElement('div');t.className='toast';
  t.style.borderColor=tipo==='ok'?'#1a5c3a':tipo==='err'?'#5c1a1a':'var(--color-border-tertiary)';
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// v1.7 — Tradução padronizada de erros para toast amigável
function traduzirErro(err) {
  if (!err) return 'Erro desconhecido';
  const msg = err.message || String(err);
  // Erros de rede do navegador
  if (/Failed to fetch|NetworkError|ERR_INTERNET|ERR_NAME/i.test(msg))
    return 'Sem conexão com o servidor. Verifique sua internet.';
  if (/AbortError|timeout/i.test(msg))
    return 'Servidor demorou demais. Tente novamente.';
  // Categorias vindas do n8n
  if (err.categoria === 'TIMEOUT') return 'IXC demorou para responder. Tente novamente.';
  if (err.categoria === 'REDE')    return 'Falha de rede ao acessar IXC.';
  if (err.categoria === 'IXC')     return 'IXC retornou erro: ' + (err.erro || msg);
  // Fallback — devolve a mensagem do servidor se for compreensível
  return msg.length < 200 ? msg : 'Erro ao processar. Tente novamente.';
}

// v1.7 — fetch com timeout configurável (usar em todas as chamadas)
async function fetchComTimeout(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function confirmar(titulo,msg,onConfirm) {
  const m=document.createElement('div'); m.className='confirm-modal';
  m.innerHTML=`<div class="confirm-box"><h3>${titulo}</h3><p>${msg}</p>
    <div class="confirm-btns">
      <button class="btn-sm btn-gray" id="c-nao">Cancelar</button>
      <button class="btn-sm btn-yellow" id="c-sim">Confirmar</button>
    </div></div>`;
  document.body.appendChild(m);
  let executando = false;
  const btnSim = m.querySelector('#c-sim');
  const btnNao = m.querySelector('#c-nao');
  btnNao.onclick = () => m.remove();
  // v1.7 — bloqueio de duplo-clique com loading state
  btnSim.onclick = async () => {
    if (executando) return;
    executando = true;
    btnSim.disabled = true; btnNao.disabled = true;
    btnSim.textContent = '⏳ Processando...';
    try {
      await onConfirm();
    } finally {
      m.remove();
    }
  };
}

// ── Ações ──────────────────────────────────────
// ixcAction removida — todas as escritas passam pelo WEBHOOK_ACOES (n8n)
// para evitar conflito de sessão com o painel IXC da atendente



async function ixcGet(endpoint, filtro) {
  const res = await fetch(WEBHOOK_LEITURAS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, filtro, token: sessaoAtual?.token })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${endpoint}`);
  return await res.json();
}

window.abrirLink = url => {
  if (typeof chrome!=='undefined'&&chrome.tabs) chrome.tabs.create({url});
  else window.open(url,'_blank');
};
window.abrirRoteador = (ip,porta) => abrirLink(`http://${ip}:${porta||'8080'}/`);
window.abrirWhatsApp = num => {
  const n=num.replace(/\D/g,'');
  abrirLink(`https://wa.me/${n.startsWith('55')?n:'55'+n}`);
};
window.copiarPIX = async (pix) => {
  try { await navigator.clipboard.writeText(pix); toast('PIX copiado!','ok'); }
  catch(e) { toast('Erro ao copiar PIX','err'); }
};

window.selecionarContrato = async function(id) {
  elInput.value=id; elLast.textContent='#'+id;
  setState('loading'); elBtn.disabled=true;
  try { await buscarContrato(id); }
  catch(e) { elErrMsg.textContent='Falha ao carregar contrato.'; setState('error'); }
  finally { elBtn.disabled=false; }
};

window.desbloquearConfianca = function(contrato_id, desbloq) {
  if (desbloq==='Indisponível') {
    const motivo = dadosAtual?.contrato?.desbloqueio_motivo;
    toast(motivo || 'Desbloqueio indisponível para este contrato','err');
    return;
  }
  confirmar('Desbloqueio de confiança',
    `Confirma o desbloqueio de confiança para o contrato #${contrato_id}?`,
    async () => {
      try {
        toast('Processando...','');
        const result = await fetch(WEBHOOK_ACOES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'desbloqueio', usar_token_master: usarTokenMaster(), contrato_id: String(contrato_id), token: sessaoAtual?.token })
        }).then(r => r.json());
        // Verificar se o IXC realmente confirmou o desbloqueio
        // O IXC retorna: {type:'success',...} ou {type:'error',...} ou {msg:'...',tipo:'sucesso'/'erro'}
        const tipo = result?.type || result?.tipo || '';
        const msg  = result?.message || result?.msg || result?.mensagem || '';
        const ok   = tipo === 'success' || tipo === 'sucesso'
                  || result?.retorno === 'S'
                  || result?.sucesso === true
                  || (msg && !tipo && !msg.toLowerCase().includes('erro') && !msg.toLowerCase().includes('error'));

        if (ok) {
          await Logger.registrarLog(sessaoAtual,'DESBLOQUEIO_CONFIANCA',{
            contrato_id,
            cliente_nome: dadosAtual?.cliente?.nome,
            cliente_id:   dadosAtual?.cliente?.id,
            sucesso: true,
            detalhes: { resultado: msg||tipo, plano: dadosAtual?.contrato?.plano }
          });
          toast(msg || 'Desbloqueio realizado com sucesso!','ok');
          invalidarCache(contrato_id); setTimeout(()=>buscarContrato(contrato_id, true),2000);
        } else {
          const errMsg = msg || tipo || 'Desbloqueio não foi aplicado pelo IXC.';
          await Logger.registrarLog(sessaoAtual,'DESBLOQUEIO_CONFIANCA',{
            contrato_id,
            cliente_nome: dadosAtual?.cliente?.nome,
            cliente_id:   dadosAtual?.cliente?.id,
            sucesso: false,
            detalhes: { erro: errMsg, retorno_raw: JSON.stringify(result) }
          });
          toast('❌ ' + errMsg,'err');
        }
      } catch(e) {
        await Logger.registrarLog(sessaoAtual,'DESBLOQUEIO_CONFIANCA',{contrato_id,sucesso:false,erro:e.message});
        toast('Erro ao realizar desbloqueio','err');
      }
    }
  );
};

window.rebootONU = function(eq_id, login, contrato_id) {
  confirmar('Reboot ONU', `Confirma o reinício da ONU do login "${login}"?`,
    async () => {
      try {
        toast('Enviando comando de reinício...', '');
        const oltSessao = await new Promise(r => chrome.storage.local.get(['olt_sessao'], d => r(d.olt_sessao || null)));
        if (!oltSessao) { toast('OLT Cloud não configurado', 'err'); return; }

        // Refresh do token
        let token = '';
        try {
          const rr = await fetch('https://carajas.oltcloud.co/api/token/refresh', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: oltSessao.refresh })
          });
          if (rr.ok) { const rd = await rr.json(); token = rd?.access || ''; }
        } catch(e) {}
        if (!token) token = oltSessao.access || '';
        if (!token) { toast('Token OLT expirado — reconfigure', 'err'); return; }

        const url = `https://carajas.oltcloud.co/api/v2/ftth/equipment/restart/${eq_id}`;
const res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        let ok = res.ok, msg = '';
        try {
          const d = await res.json();
          ok = ok || d?.return === true || d?.success === true;
          msg = d?.message || d?.detail || '';
        } catch(e) {}

        if (ok) {
          toast('Reinício enviado! ONU vai reiniciar em instantes.', 'ok');
          await Logger.registrarLog(sessaoAtual, 'REBOOT_ONU', { contrato_id, detalhes: { eq_id, login }, sucesso: true });
        } else {
          toast('Falha: ' + (msg || `HTTP ${res.status}`), 'err');
        }
      } catch(e) {
        toast(traduzirErro(e), 'err');
      }
    }
  );
}

window.desconectarLogin = function(login_id,login,contrato_id) {
  confirmar('Desconectar login',`Confirma a desconexão do login "${login}"?`,
    async () => {
      // v1.7.7 — feedback imediato
      toast('⚡ Desconectando...','');
      try {
        const res = await fetch(WEBHOOK_ACOES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'desconectar', usar_token_master: usarTokenMaster(), login_id: String(login_id), token: sessaoAtual?.token })
        }).then(r => r.json());

        // Log em PARALELO (fire-and-forget) — não bloqueia o usuário
        Logger.registrarLog(sessaoAtual,'DESCONEXAO_LOGIN',{
          contrato_id,
          cliente_nome: dadosAtual?.cliente?.nome,
          cliente_id:   dadosAtual?.cliente?.id,
          sucesso: res?.ok !== false,
          detalhes: { login_id, login, resultado: res?.mensagem||'Desconectado' }
        }).catch(() => {/* ignora — não atrapalha UX */});

        if (res?.ok === false) {
          toast('❌ ' + (res?.mensagem || res?.erro || 'Falha ao desconectar'),'err');
          return;
        }
        toast('✓ ' + (res?.mensagem||'Login desconectado!'),'ok');
        // v1.7.7 — reduzido de 2000→700ms (Mikrotik leva ~500ms pra atualizar o status)
        invalidarCache(contrato_id); setTimeout(()=>buscarContrato(contrato_id, true), 700);
      } catch(e) {
        toast('Erro ao desconectar: ' + traduzirErro(e), 'err');
      }
    }
  );
};

// ── Card e Item builders ───────────────────────
// v1.7.5 — Mapeamento de cards para abas
const CARD_TAB = {
  'contrato':         'geral',
  'cliente':          'geral',
  'logins':           'conexao',
  'fin-ajustes':      'financas',
  'fin':              'financas',
  'os-ab':            'atendimento',
  'os-en':            'atendimento',
  'tickets':          'atendimento',
  'hist-contrato':    'historicos',
  'negociacoes':      'historicos',
  'comodatos':        'servicos',
  'produtos-contrato':'servicos',
  'tv-sva':           'servicos'
};

function card(id,label,badges,html,open) {
  const bHtml=(badges||[]).map(([v,c])=>badge(v,c||bc(v))).join(' ');
  const tab = CARD_TAB[id] || 'geral';
  return `<div class="card" data-tab="${tab}">
    <div class="card-header" data-toggle="${id}">
      <span class="card-label">${label}</span>
      <span class="card-status">${bHtml}</span>
      <span class="chevron ${open?'open':''}" id="chev-${id}">▼</span>
    </div>
    <div class="card-body ${open?'':'collapsed'}" id="body-${id}">${html}</div>
  </div>`;
}

function item(id,titleHtml,bodyHtml,open,extraBadge,loginIdx) {
  const bodyId = loginIdx!==undefined?`body-login-${loginIdx}`:`body-${id}`;
  return `<div class="item">
    <div class="item-header" data-toggle="${id}">${titleHtml}${extraBadge||''}
      <span class="chevron ${open?'open':''}" id="chev-${id}">▼</span>
    </div>
    <div class="item-body ${open?'':'collapsed'}" id="${bodyId}" data-item-id="body-${id}">${bodyHtml}</div>
  </div>`;
}

// ── Render seleção CPF ─────────────────────────
function renderSelecao(contratos) {
  if (!contratos || !Array.isArray(contratos)) { setState('error'); document.getElementById('error-msg').textContent='Nenhum contrato encontrado.'; return; }
  elRes.innerHTML='';
  const clientes={};
  contratos.forEach(c=>{
    const cid=c.cliente.id;
    if (!clientes[cid]) clientes[cid]={info:c.cliente,contratos:[]};
    clientes[cid].contratos.push(c);
  });

  let html='';
  Object.values(clientes).forEach(cli=>{
    let cliHtml=`<div class="cli-info">
      <span class="cli-nome">${cli.info.nome}</span>
      <span class="cli-cpf">${cli.info.cpf}</span>
      ${cli.info.celular?`<button class="btn-sm btn-green" style="margin-left:auto" data-action="whatsapp" data-p="${cli.info.celular}">💬</button>`:''}
    </div>`;

    cli.contratos.forEach(c=>{
      const onlineB = c.login?badge(c.login.online,bc(c.login.online)):'';
      const statusB = badge(c.status,bc(c.status));
      let alertaOS='';
      if (c.em_manutencao&&c.os_do_login?.length>0) {
        alertaOS=`<div class="alerta-manutencao"><strong>⚠ LOGIN EM ÁREA DE MANUTENÇÃO</strong>
          <div><div style="font-weight:700;margin-bottom:2px">OS do login em manutenção:</div>
          ${c.os_do_login.map(o=>`<div style="margin-top:3px"><span style="font-weight:600">#${o.id} — ${o.assunto}</span>
            ${o.mensagem?`<div style="opacity:.85;margin-top:2px">${o.mensagem.substring(0,160)}</div>`:''}</div>`).join('')}
          </div></div>`;
      } else if (c.em_manutencao&&c.os_abertas_qtd>0) {
        alertaOS=`<div class="alerta-os"><span class="alerta-os-icon">⚠</span>
          <div>${c.os_abertas_qtd} OS aberta(s)${c.os_resumo?.length?' : '+c.os_resumo.join(' · '):''}</div></div>`;
      }
      cliHtml+=`<div class="contrato-card ${c.em_manutencao?'card-alerta':''}" data-contrato-id="${c.contrato_id}">
        <div class="contrato-top"><span class="contrato-id">#${c.numero}</span>${statusB} ${onlineB}${c.em_manutencao?'<span class="badge vermelho" style="margin-left:auto">⚠ EM MANUTENÇÃO</span>':''}</div>
        <div class="contrato-plano">${c.plano||'—'}</div>${alertaOS}
        <div class="contrato-meta">
          ${c.endereco?`<span>📍 ${c.endereco}</span>`:''}
          ${c.mensalidade?`<span>R$ ${c.mensalidade}</span>`:''}
          ${c.login?.login?`<span>👤 ${c.login.login}</span>`:''}
          ${c.login?.ip?`<span>🌐 ${c.login.ip}</span>`:''}
        </div>
        <div class="contrato-hint">Clique para ver detalhes →</div>
      </div>`;
    });
    html+=`<div class="cli-block">${cliHtml}</div>`;
  });
  elRes.innerHTML=html;
  setState('result');
}

// ── Render principal ───────────────────────────
function render(d) {
  dadosAtual = d;
  elRes.innerHTML='';
  const c=d.contrato, cl=d.cliente, fin=d.financeiro;
  // Salvar no histórico (protegido contra erro)
  try {
    salvarNoHistorico(c.numero||c.id, cl.nome, c.status_acesso||c.status).then(()=>{
      carregarHistoricoConsultas().then(renderHistorico);
    });
  } catch(e) {}

  // ── Barra cliente ativo no topo ──
  const barCli = document.getElementById('cliente-ativo');
  if (barCli) {
    const stAcesso = c.status_acesso || c.status;
    const stCls = bc(stAcesso);
    barCli.style.display = 'flex';
    barCli.innerHTML = `
      <span class="cli-ativo-nome">👤 ${cl.nome}</span>
      <span class="cli-ativo-num">#${c.numero}</span>
      <span class="cli-ativo-status ${stCls}">${stAcesso}</span>
    `;
  }

  // ── CONTRATO ──
  // Status de bloqueio do acesso
  const bloqueado = c.status_acesso && !['Ativo','Disponível'].includes(c.status_acesso);
  const desbDisp  = c.desbloqueio_conf === 'Disponível';
  const desbAtivo = c.desbloqueio_conf_ativo === 'S'; // já em uso
  // Contrato encerrado (inativo/desistiu/negativado) — sem desbloqueio; mostra data de encerramento
  const encerrado = ['I','D','N'].includes(c.status_raw);

  // Cadeado: estado visual
  let cadeadoCls, cadeadoIcon, cadeadoTip;
  if (!bloqueado) {
    cadeadoCls='cadeado-aberto'; cadeadoIcon='🔓'; cadeadoTip='Acesso liberado';
  } else if (desbDisp) {
    cadeadoCls='cadeado-disponivel'; cadeadoIcon='🔒'; cadeadoTip='Bloqueado — desbloqueio disponível. Clique para desbloquear';
  } else {
    cadeadoCls='cadeado-bloqueado'; cadeadoIcon='🔒';
    cadeadoTip='Bloqueado — desbloqueio indisponível' + (c.desbloqueio_motivo ? ': ' + c.desbloqueio_motivo : '');
  }

  // Botão único de copiar tudo — no início dos resultados
  elRes.innerHTML = `<button class="btn-copiar-tudo" id="btn-copiar-tudo" data-action="copiar-tudo">
    ⎘ Copiar tudo
  </button>`;

  // v1.7.5 — Barra de abas
  elRes.innerHTML += `<div class="tabs-bar" id="tabs-bar">
    <button class="tab-btn active" data-tab-target="geral">🏠 Geral</button>
    <button class="tab-btn" data-tab-target="conexao">🔌 Conexão</button>
    <button class="tab-btn" data-tab-target="financas">💰 Finanças</button>
    <button class="tab-btn" data-tab-target="atendimento">🛠 Atendimento</button>
    <button class="tab-btn" data-tab-target="historicos">📜 Históricos</button>
    <button class="tab-btn" data-tab-target="servicos">📦 Serviços</button>
  </div>`;

  let cHtml='';

  // Faixa de bloqueio — destaque máximo
  if (bloqueado) {
    const isCM = (c.status_acesso||'').includes('Manual');
    const isCA = (c.status_acesso||'').includes('Automático') || (c.status_acesso||'').includes('Atraso');
    const corFaixa = isCM ? 'faixa-bloqueio-manual' : 'faixa-bloqueio-auto';
    cHtml += `<div class="faixa-bloqueio ${corFaixa}">
      <span class="faixa-icon">${isCM?'🔒':'⛔'}</span>
      <span class="faixa-txt">${c.status_acesso.toUpperCase()}</span>
      <span class="faixa-icon">${isCM?'🔒':'⛔'}</span>
    </div>`;
  }

  // Barra de status + cadeado
  cHtml += `<div class="contrato-status-bar">
    <div class="status-bar-info">
      <span class="status-bar-item ${bc(c.status)}">${c.status}</span>
      ${c.status_acesso&&c.status_acesso!==c.status?`<span class="status-bar-item ${bc(c.status_acesso)}">${c.status_acesso}</span>`:''}
      ${desbAtivo&&!encerrado?'<span class="status-bar-item amarelo">🕐 Desbloqueio ativo</span>':''}
    </div>
    ${encerrado ? '' : `<button class="cadeado-btn ${cadeadoCls}" data-action="desbloquear" data-p="${c.id}" data-p2="${c.desbloqueio_conf}" title="${cadeadoTip}">
      <span class="cadeado-icon">${cadeadoIcon}</span>
      <span class="cadeado-label">${bloqueado?(desbDisp?'Desbloquear':'Bloqueado'):'Liberado'}</span>
    </button>`}
  </div>`;

  // Alertas no topo
  if (fin?.titulos_vencidos>0) cHtml+=`<div class="alerta-financeiro">
    <div class="af-titulo">⚠ Financeiro em atraso</div>
    <div class="af-detalhe">${fin.titulos_vencidos} título(s) vencido(s) — verifique antes de desbloquear</div>
  </div>`;
  if (c.motivo_restricao) cHtml += infoBox('⚠ Restrição de acesso',c.motivo_restricao,'warn');

  cHtml += '<div id="copy-contrato">';
  cHtml += row('Nº contrato', c.numero);
  cHtml += row('Plano', c.plano);
  cHtml += row('Velocidade', c.velocidade);
  cHtml += row('Vencimento', c.vencimento);
  cHtml += row('Mensalidade', c.mensalidade?'R$ '+c.mensalidade:null);
  cHtml += row('Pago até', fmt(c.pago_ate));
  cHtml += row('Ativação', fmt(c.data_ativacao));
  cHtml += row('Última renovação', fmt(c.data_renovacao));
  cHtml += row('Expiração', fmt(c.data_expiracao));
  cHtml += row('Fidelidade', c.fidelidade?c.fidelidade+' meses':null);
  // Datas de encerramento (quando houver)
  cHtml += row('Cancelamento', fmt(c.data_cancelamento), 'vermelho');
  cHtml += row('Desistência', fmt(c.data_desistencia), 'vermelho');
  cHtml += row('Negativação', fmt(c.data_negativacao), 'vermelho');
  cHtml += row('Desativação', fmt(c.data_desativacao));
  // Desbloqueio só faz sentido em contrato não encerrado
  if (!encerrado) cHtml += row('Desbl. conf.', c.desbloqueio_conf, bc(c.desbloqueio_conf));
  cHtml += '</div>';

  if (c.obs) cHtml += infoBox('Observação',c.obs);

  // Link de assinatura digital (quando disponível)
  if (c.url_assinatura) {
    cHtml += `<div class="btns" style="margin-top:8px">
      <button class="btn-sm btn-gray" data-action="pix" data-p="${c.url_assinatura}" title="Copiar link de assinatura digital">📋 Copiar link de assinatura digital</button>
    </div>`;
  }

  // v1.7.7 — Indicador discreto da versão do workflow que respondeu (debug)
  if (d._workflow_version) {
    cHtml += `<div style="text-align:right;font-size:9px;color:var(--tx3);margin-top:4px;font-family:var(--font-mono);opacity:.5">⚙ workflow v${d._workflow_version}</div>`;
  } else {
    cHtml += `<div style="text-align:right;font-size:9px;color:var(--y);margin-top:4px;font-family:var(--font-mono)">⚠ workflow antigo (sem versão)</div>`;
  }

  elRes.innerHTML += card('contrato','Contrato #'+c.id, [], cHtml, true); // sempre aberto

  // ── CLIENTE ──
  let clHtml='';
  clHtml += '<div id="copy-cliente">';
  clHtml += row('Nome', cl.nome);
  clHtml += row('CPF/CNPJ', cl.cpf_cnpj);
  clHtml += row('Telefone', cl.telefone);
  clHtml += row('Celular', cl.celular);
  clHtml += row('WhatsApp', cl.whatsapp);
  clHtml += row('E-mail', cl.email);
  clHtml += row('Endereço', cl.endereco);
  clHtml += row('CEP', cl.cep);
  clHtml += row('Referência', cl.referencia);
  clHtml += '</div>';

  const wa=cl.whatsapp||cl.celular;

  elRes.innerHTML += card('cliente','Cliente — '+cl.nome, [], clHtml, true);

  // ── LOGINS ──
  let logHtml = d.logins.length===0?'<div class="empty">Nenhum login</div>':'';
  d.logins.forEach((l,i)=>{
    let body='';
    body += secT('Status do acesso');
    body += mrow('Status', l.status_acesso, bc(l.status_acesso));
    body += mrow('Online', l.online, bc(l.online));

    if (l.em_os_manutencao&&l.os_do_login?.length>0) {
      body+=`<div class="alerta-manutencao" style="margin:6px 0"><strong>⚠ LOGIN EM ÁREA DE MANUTENÇÃO</strong></div>`;
      l.os_do_login.forEach(o=>{
        body+=`<div class="alerta" style="margin:4px 0">
          <strong>#${o.id} — ${o.assunto} ${badge(o.status,'amarelo')} ${o.tipo?badge(o.tipo,'azul'):''}</strong>
          <div style="font-size:10px;opacity:.7;margin:3px 0">${o.abertura?'Aberta: '+fmt(o.abertura):''}${o.previsao?' | Prev: '+fmt(o.previsao):''}${o.tecnico?' | '+o.tecnico:''}</div>
          ${o.mensagem?infoBox('Descrição',o.mensagem):''}
          ${o.mensagem_resposta?infoBox('Atualização',o.mensagem_resposta,'resp'):''}
          <div class="btns"><button class="btn-sm btn-blue" data-action="link" data-p="${o.link_ixc}">🔗 Abrir OS</button></div>
        </div>`;
      });
    }

    body += mrow('Conexão', l.conexao);
    body += `<div id="copy-rede-${i}">`;
    body += secT('Rede');
    body += mrow('IP', l.ip);
    body += mrow('MAC cliente', l.mac);
    body += mrow('ONU MAC', l.onu_mac);
    body += mrow('Tipo conexão', l.tipo_conexao);
    body += mrow('MTU', l.mtu);
    body += mrow('Concentrador', l.concentrador);
    body += secT('Fibra FTTH');
    body += mrow('Caixa FTTH', l.caixa_ftth);
    body += mrow('Porta', l.ftth_porta);
    body += mrow('Splitter', l.splitter);
    body += mrow('Transmissor', l.id_transmissor);
    if (l.historico_fibra?.length>0) {
      body+=secT('Histórico sinal fibra');
      l.historico_fibra.forEach(h=>{ body+=`<div class="meta-row"><span class="meta-key">${fmt(h.data)||'—'}</span><span class="meta-val">ONU: ${h.potencia_onu||'—'} | OLT: ${h.potencia_olt||'—'}</span></div>`; });
    }
    body += secT('Histórico de conexão');
    body += mrow('Última conexão', fmt(l.ultima_conexao));
    body += mrow('Última descon.', fmt(l.ultima_desconexao));
    body += mrow('Tempo conectado', l.tempo_conectado);
    body += mrow('Desconexões', l.count_desconexao);
    body += mrow('Motivo descon.', l.motivo_desconexao);
    body += secT('Consumo');
    body += mrow('Download', l.download_atual);
    body += mrow('Upload', l.upload_atual);
    body += mrow('Franquia', l.franquia_consumo);
    body += '</div>';

    // OLT Cloud placeholder
    body+=`<div class="olt-section"><div class="sec-title">OLT Cloud — Sinal em tempo real</div><div class="olt-status-msg cinza">⏳ Carregando dados da OLT...</div></div>`;

    body+=`<div class="btns">
      ${l.link_roteador?`<button class="btn-sm btn-blue" data-action="roteador" data-p="${l.ip}" data-p2="${l.porta_http}">🌐 Roteador</button>`:''}
      <span id="btn-reboot-${i}"></span>
      <button class="btn-sm btn-red" data-action="desconectar" data-p="${l.id}" data-p2="${l.login}" data-p3="${c.id}">⚡ Desconectar</button>
    </div>`;

    const emOS=l.em_os_manutencao?`<span class="os-em-os">EM OS</span> `:'';
    const extraB=emOS+badge(l.status_acesso,bc(l.status_acesso))+' '+badge(l.online,bc(l.online));
    logHtml+=item(`login-${i}`,`<span class="item-title">${l.login}</span>`,body,true,extraB,i);
  });
  elRes.innerHTML += card('logins',`Logins PPPoE (${d.logins.length})`, [], logHtml, true);

  // ── ACRÉSCIMOS E DESCONTOS DO CONTRATO (aba Finanças) ──
  if (d.descontos?.length || d.acrescimos?.length) {
    let ajHtml = '';
    (d.acrescimos||[]).forEach(x => {
      const det = [x.descricao, x.validade?('até '+x.validade):null].filter(Boolean).join(' · ');
      ajHtml += mrow('Acréscimo', '+ R$ '+(x.valor||'—')+(x.percentual&&Number(x.percentual)>0?' ('+x.percentual+'%)':'')+(det?' — '+det:''), 'amarelo');
    });
    (d.descontos||[]).forEach(x => {
      const det = [x.descricao, x.validade?('até '+x.validade):null].filter(Boolean).join(' · ');
      ajHtml += mrow('Desconto', '− R$ '+(x.valor||'—')+(x.percentual&&Number(x.percentual)>0?' ('+x.percentual+'%)':'')+(det?' — '+det:''), 'verde');
    });
    const nAj = (d.acrescimos?.length||0)+(d.descontos?.length||0);
    elRes.innerHTML += card('fin-ajustes','Acréscimos e descontos', [[nAj+' item(ns)','amarelo']], ajHtml, true);
  }

  // ── FINANCEIRO ──
  if (fin?.titulos?.length>0) {
    const SF={A:'Em aberto',C:'Pago',B:'Baixado',P:'Pago parcial'};
    const fB=fin.titulos_vencidos>0?[[fin.titulos_vencidos+' vencido(s)','vermelho']]:fin.titulos_abertos>0?[[fin.titulos_abertos+' aberto(s)','amarelo']]:[['Em dia','verde']];
    let finHtml='<div id="fin-loading" style="text-align:center;padding:10px;color:var(--acc);font-size:11px">⏳ Carregando boletos e PIX...</div>';
    elRes.innerHTML += card('fin','Financeiro', fB, finHtml, fin.titulos_vencidos>0);

    // Carregar boletos+PIX em background via n8n
    if (d.cliente?.id) {
      fetch(WEBHOOK_ACOES, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ acao:'titulos_abertos', cliente_id:String(d.cliente.id), contrato_id:String(d.contrato?.id||d.contrato_id||''), token:sessaoAtual?.token })
      }).then(r=>r.json()).then(res=>{
        const loadEl = document.getElementById('fin-loading');
        if (!loadEl) return;
        // v1.7.7 — se webhook retornou vazio/erro, manter os títulos do lookup original (não sobrescrever com [])
        const titulosWebhook = Array.isArray(res?.titulos) ? res.titulos : null;
        const titulos = (titulosWebhook && titulosWebhook.length > 0) ? titulosWebhook : (fin.titulos || []);
        let finHtml2='';
        // Separar abertos e pagos
        const abertos = titulos.filter(t => t.status === 'A');
        const pagos   = titulos.filter(t => t.status !== 'A').slice(0, 5); // 5 pagos mais recentes (lista já vem DESC)
        const ordenados = [...abertos, ...pagos];

        if (ordenados.length === 0) {
          loadEl.outerHTML = '<div class="empty">Nenhum título encontrado</div>';
          return;
        }

        ordenados.forEach((t,i)=>{
          const sf = statusFatura(t);
          let tBody = mrow('Vencimento',t.vencimento)
                    + mrow('Valor','R$ '+(t.valor||t.valor_aberto||'—'))
                    + mrow('Status', sf.label, sf.cor)
                    + mrow('Origem', t.tipo_contrato==='avulso'?'Avulso':'Recorrente');

          // Desconto / acréscimo (juros+multa) + descrição — quando houver
          if (t.desconto)  tBody += mrow('Desconto', '− R$ '+t.desconto + (t.desconto_validade?' (válido até '+t.desconto_validade+')':''), 'verde');
          if (t.acrescimo) tBody += mrow('Acréscimo', '+ R$ '+t.acrescimo + (t.juros&&t.multa?' (juros + multa)':t.juros?' (juros)':' (multa)'), 'amarelo');
          if (t.valor_total) tBody += mrow('Valor total', 'R$ '+t.valor_total);
          if ((t.desconto||t.acrescimo) && t.obs) tBody += mrow('Descrição', t.obs);

          // PIX — mostrar sempre que tiver qr_code ou copia e cola
          const temPix = t.pix_copia_cola || t.qr_code;
          if (temPix) {
            let pixHtml = '<div class="pix-box"><div class="pix-label">⚡ PIX</div>';
            if (t.qr_code) pixHtml += '<img src="data:image/png;base64,' + t.qr_code + '" class="pix-qr">';
            if (t.pix_copia_cola) {
              pixHtml += '<div class="pix-code">' + t.pix_copia_cola + '</div>';
              pixHtml += '<button class="btn-sm btn-green" data-action="pix" data-p="' + t.pix_copia_cola + '">⚡ Copiar PIX</button>';
            } else {
              pixHtml += '<div style="font-size:10px;color:var(--tx3);margin-top:4px">PIX copia e cola indisponível nesta carteira</div>';
            }
            pixHtml += '</div>';
            tBody += pixHtml;
          }

          // Linha digitável
          if (t.linha_digitavel) {
            tBody += `<div style="margin:6px 0;padding:6px 8px;background:var(--bg3);border-radius:6px;border:1px solid var(--b)">
              <div style="font-size:9px;color:var(--tx3);font-family:var(--font-head);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Linha digitável</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--tx);word-break:break-all;line-height:1.5">${t.linha_digitavel}</div>
              <button class="btn-sm btn-gray" style="margin-top:6px" data-action="pix" data-p="${t.linha_digitavel}">📋 Copiar linha dig.</button>
            </div>`;
          }

          // Boleto — Demanda 1: quando NÃO comunicado ao banco, geração é opcional (botão)
          const emailBtn = '<button class="btn-sm btn-gray" data-action="enviar-boleto-email" data-p="' + t.id + '" data-p2="' + (d.cliente?.email||'') + '">✉ Enviar por e-mail</button>';
          if (t.status==='A' && t.comunicado_banco === false) {
            tBody += '<div class="boleto-aviso"><span class="ba-ic">⚠</span><span>Boleto ainda não comunicado ao banco — geração opcional</span></div>'
              + '<div class="btns" id="boleto-btns-' + t.id + '">'
              + '<button class="btn-sm btn-gray" data-action="boleto" data-p="' + t.id + '">📄 Gerar dados do boleto</button>'
              + '</div>';
          } else if (t.boleto_base64) {
            const blobUrl  = 'data:application/pdf;base64,' + t.boleto_base64;
            const fileName = 'boleto_' + (t.documento||t.id) + '.pdf';
            tBody += '<div class="btns" id="boleto-btns-' + t.id + '">'
              + '<a class="btn-sm btn-blue" href="' + blobUrl + '" download="' + fileName + '">📄 Baixar boleto PDF</a>'
              + emailBtn
              + '</div>';
          } else if (t.status==='A' && !temPix && !t.linha_digitavel) {
            tBody += '<div class="btns" id="boleto-btns-' + t.id + '">'
              + '<button class="btn-sm btn-gray" data-action="boleto" data-p="' + t.id + '">🔄 Tentar gerar boleto</button>'
              + emailBtn
              + '</div>';
          } else if (t.status==='A') {
            tBody += '<div class="btns" id="boleto-btns-' + t.id + '">'
              + emailBtn
              + '</div>';
          }

          const expandir = t.status==='A'; // abertos sempre expandidos
          const avulsoBadge = t.tipo_contrato==='avulso' ? ' '+badge('Avulso','cinza') : '';
          finHtml2+=item(`fin-${i}`,
            `<span class="item-title">R$ ${t.valor||'—'}</span><span class="item-sub">${t.vencimento||'—'} · ${sf.label}</span>`,
            tBody, expandir,
            badge(sf.label, sf.cor) + avulsoBadge);
        });
        loadEl.parentElement.innerHTML = finHtml2 || '<div class="empty">Sem títulos</div>';
      }).catch(()=>{
        // Fallback: exibir sem boleto/PIX
        const loadEl = document.getElementById('fin-loading');
        if (loadEl) {
          let finHtml2='';
          fin.titulos.forEach((t,i)=>{
            const vencido = t.status==='A'&&new Date(t.vencimento)<new Date();
            const sl=SF[t.status]||(vencido?'Vencido':'—');
            let tBody=mrow('Vencimento',t.vencimento)+mrow('Valor','R$ '+t.valor);
            tBody+=`<div class="btns"><button class="btn-sm btn-blue" data-action="boleto" data-p="${t.id}">📄 Ver boleto/PIX</button></div>`;
            finHtml2+=item(`fin-${i}`,`<span class="item-title">R$ ${t.valor}</span><span class="item-sub">${t.vencimento||'—'}</span>`,tBody,false,badge(vencido?'Vencido':sl,vencido?'vermelho':bc(sl)));
          });
          loadEl.parentElement.innerHTML=finHtml2;
        }
      }).catch(err => {
        // v1.7.7 — Se webhook caiu, renderiza com dados do lookup (sem boleto/PIX) em vez de mostrar "carregando" pra sempre
        console.warn('[FIN] Erro ao enriquecer títulos:', err);
        const loadEl = document.getElementById('fin-loading');
        if (!loadEl) return;
        const titulos = fin.titulos || [];
        if (titulos.length === 0) {
          loadEl.outerHTML = '<div class="empty">⚠ Erro ao carregar boletos. Tente recarregar a busca.</div>';
          return;
        }
        let finHtml2 = '<div style="background:rgba(255,180,0,.1); color:var(--y); padding:6px 10px; border-radius:6px; font-size:11px; margin-bottom:8px">⚠ Boletos/PIX indisponíveis (mostrando dados básicos)</div>';
        titulos.forEach((t,i)=>{
          const vencido = t.status==='A'&&new Date(t.vencimento)<new Date();
          const sl=SF[t.status]||(vencido?'Vencido':'—');
          let tBody=mrow('Vencimento',t.vencimento)+mrow('Valor','R$ '+t.valor);
          finHtml2+=item(`fin-${i}`,`<span class="item-title">R$ ${t.valor}</span><span class="item-sub">${t.vencimento||'—'}</span>`,tBody,false,badge(vencido?'Vencido':sl,vencido?'vermelho':bc(sl)));
        });
        loadEl.parentElement.innerHTML = finHtml2;
      });
    }
  }

  // ── OS ABERTAS ──
  let osAbHtml=d.os_abertas.length===0?'<div class="empty">Nenhuma OS em aberto</div>':'';
  d.os_abertas.forEach((o,i)=>{
    let b=mrow('Protocolo',o.protocolo)+mrow('Abertura',fmt(o.abertura))+mrow('Técnico',o.tecnico);
    if(o.diagnostico) b+=infoBox('Diagnóstico',o.diagnostico,'diag');
    if(o.mensagem) b+=infoBox('Mensagem',o.mensagem);
    if(o.mensagem_resposta) b+=infoBox('Atualização',o.mensagem_resposta,'resp');
    const labelAg = o.status_raw === 'AG' ? '🔄 Reagendar' : '📅 Agendar';
    b+=`<div class="btns">
      <button class="btn-sm btn-yellow" data-action="abrir-agendar" data-p="${o.id}" data-p2="${(o.assunto||'').replace(/"/g,'&quot;')}">${labelAg}</button>
    </div>`;
    const extraB=badge(o.status,bc(o.status))+' '+badge('🕐 SLA: '+slaLabel(o.status_sla),bcSLA(o.status_sla));
    osAbHtml+=item(`os-ab-${i}`,`<span class="item-title">#${o.id}</span><span class="item-sub">${o.assunto||'—'}</span>`,b,true,extraB);
  });
  elRes.innerHTML += card('os-ab','OS Abertas', d.os_abertas.length>0?[[d.os_abertas.length+' aberta(s)','amarelo']]:[], osAbHtml, d.os_abertas.length>0);

  // ── OS ENCERRADAS ──
  let osEnHtml=d.os_encerradas.length===0?'<div class="empty">Sem OS encerradas recentes</div>':'';
  d.os_encerradas.forEach((o,i)=>{
    let b=mrow('Protocolo',o.protocolo)+mrow('Abertura',fmt(o.abertura))+mrow('Fechamento',fmt(o.fechamento))+mrow('Técnico',o.tecnico);
    if(o.diagnostico) b+=infoBox('Diagnóstico',o.diagnostico,'diag');
    if(o.mensagem) b+=infoBox('Mensagem',o.mensagem);
    if(o.mensagem_resposta) b+=infoBox('Encerramento',o.mensagem_resposta,'resp');
    osEnHtml+=item(`os-en-${i}`,`<span class="item-title">#${o.id}</span><span class="item-sub">${o.assunto||'—'}</span>`,b,false,badge('Finalizada','verde'));
  });
  elRes.innerHTML += card('os-en',`OS Encerradas (${d.os_encerradas.length})`, [], osEnHtml, false);

  // ── COMODATOS ──
  if (d.comodatos?.length>0) {
    let comHtml=d.comodatos.map((co,i)=>{
      // v1.7.6 — tipo já vem do workflow enriquecido
      const tipoBadge = co.tipo ? badge(co.tipo, 'cinza') + ' ' : '';
      let b=mrow('Equipamento',  co.produto||co.nome_produto||co.descricao_produto||co.nome)
           +mrow('Tipo',         co.tipo||null)
           +mrow('Descrição',    co.descricao||co.obs||co.observacao||null)
           +mrow('Modelo',       co.modelo||co.nome_modelo||null)
           +mrow('Serial',       co.serial||co.numero_serie||co.sn||null)
           +mrow('MAC',          co.mac||co.mac_address||null)
           +mrow('Patrimônio',   co.patrimonio||co.num_patrimonio||co.id_patrimonio||null)
           +mrow('Entrega',      fmt(co.entrega||co.data_entrega||null))
           +mrow('Devolução',    fmt(co.devolucao||co.data_devolucao||null));
      const titulo=co.produto||co.nome_produto||('Equip. #'+co.id);
      return item(`com-${i}`,`<span class="item-title">${titulo}</span>`,b,false,tipoBadge + badge('Comodato','azul'));
    }).join('');
    elRes.innerHTML += card('comodatos',`Comodatos (${d.comodatos.length})`,[['Equipamentos','azul']],comHtml,false);
  }

  // ── CARDS EXTRAS — carregamento lazy ──
  elRes.innerHTML += card('tickets','Tickets de Atendimento',[],
    `<div id="tickets-content"><div class="lazy-load" data-load="tickets">📂 Clique para carregar tickets do cliente</div></div>`, false);

  elRes.innerHTML += card('hist-contrato','Histórico do Contrato',[],
    `<div id="hist-content"><div class="lazy-load" data-load="historico">📋 Clique para carregar histórico</div></div>`, false);

  elRes.innerHTML += card('negociacoes','Negociações CRM',[],
    `<div id="negoc-content"><div class="lazy-load" data-load="negociacoes">🤝 Clique para carregar negociações</div></div>`, false);

  elRes.innerHTML += card('produtos-contrato','Produtos do Contrato',[],
    `<div id="prod-content"><div class="lazy-load" data-load="produtos">📦 Clique para carregar produtos</div></div>`, false);

  elRes.innerHTML += card('tv-sva','TV / SVA',[],
    `<div id="tvsva-content"><div class="lazy-load" data-load="tvsva">📺 Clique para carregar TV/SVA</div></div>`, false);

  setState('result');

  // v1.7.5 — Mostra só os cards da aba 'geral' por padrão
  abaAtual = 'geral';
  document.querySelectorAll('.card[data-tab]').forEach(card => {
    card.style.display = card.getAttribute('data-tab') === 'geral' ? '' : 'none';
  });
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab-target') === 'geral');
  });

  // Carregar OLT Cloud em paralelo
  if (d.logins?.length>0) buscarOLT(d.logins).catch(e=>console.warn('OLT:',e));

  // Log
  Logger.registrarLog(sessaoAtual,'CONSULTA_CONTRATO',{
    contrato_id:d.contrato_id, cliente_nome:cl.nome, cliente_id:cl.id,
    detalhes:{plano:c.plano,status:c.status}
  });
}

// ── Lazy load dos cards extras (fallback se usuário clicar manual) ─────
document.addEventListener('click', async e => {
  const lazy = e.target.closest('.lazy-load');
  if (!lazy) return;
  const tipo = lazy.getAttribute('data-load');
  if (!tipo||!dadosAtual) return;
  // v1.7.5 — marca o body do card como loaded pra não disparar de novo na troca de aba
  const card = lazy.closest('.card-body');
  if (card) card.dataset.loaded = 'true';
  lazy.textContent = '⏳ Carregando...';
  try {
    if (tipo==='tickets')     await carregarTickets(lazy);
    if (tipo==='historico')   await carregarHistoricoContrato(lazy);
    if (tipo==='negociacoes') await carregarNegociacoes(lazy);
    if (tipo==='produtos')    await carregarProdutos(lazy);
    if (tipo==='tvsva')       await carregarTVSVA(lazy);
  } catch(e) {
    console.error('Lazy load erro:', tipo, e);
    if (lazy.parentElement) lazy.innerHTML=`❌ Erro: ${traduzirErro(e)}`;
    if (card) card.dataset.loaded = 'false';
  }
});

async function carregarTickets(el) {
  const cl = dadosAtual.cliente;
  // Buscar por id_cliente
  const res = await ixcGet('su_ticket',{
    qtype:'su_ticket.id_cliente', query:String(cl.id),
    oper:'=', page:'1', rp:'5',
    sortname:'su_ticket.id', sortorder:'desc'
  });
  const tickets = res?.registros||[];
  if (!tickets.length) {
    if (el.parentElement) el.parentElement.innerHTML=`<div class="empty">Nenhum ticket encontrado</div>`;
    return;
  }

  // v1.7.6 — Buscar descrição de cada assunto único (em paralelo)
  const idsAssunto = [...new Set(tickets.map(t => t.id_assunto).filter(Boolean))];
  const mapaAssunto = {};
  if (idsAssunto.length > 0) {
    await Promise.all(idsAssunto.map(async idA => {
      try {
        // v1.8.4 — su_ticket_assunto não é exposto na API; o assunto do ticket vive em su_oss_assunto
        const ra = await ixcGet('su_oss_assunto', {
          qtype: 'su_oss_assunto.id', query: String(idA),
          oper: '=', page: '1', rp: '1',
          sortname: 'su_oss_assunto.id', sortorder: 'asc'
        });
        const a = ra?.registros?.[0];
        if (a) mapaAssunto[idA] = a.assunto || a.descricao || a.nome || ('Assunto #'+idA);
      } catch(e) { /* fallback abaixo */ }
    }));
  }

  const STATUS={A:'Aberto',F:'Finalizado',C:'Cancelado',R:'Respondido',P:'Pendente',E:'Encaminhado'};
  let html=tickets.map((t,i)=>{
    const sl=STATUS[t.status]||t.status;
    // Prioridade: descrição vinda do lookup, depois campos que o IXC pode mandar
    const assunto = mapaAssunto[t.id_assunto] || t.titulo || t.assunto || t.nome_assunto || t.descricao_assunto || ('Assunto #'+(t.id_assunto||t.id));
    let b=mrow('Assunto',   assunto)
         +mrow('Abertura',  fmt(t.data_abertura))
         +mrow('Fechamento',fmt(t.data_fechamento))
         +mrow('Setor',     t.nome_setor)
         +mrow('Atendente', t.nome_atendente||t.nome_colaborador);
    if(t.descricao||t.mensagem)         b+=infoBox('Descrição',  t.descricao||t.mensagem);
    if(t.resposta||t.mensagem_resposta) b+=infoBox('Resposta',   t.resposta||t.mensagem_resposta,'resp');
    return item(`tkt-${i}`,`<span class="item-title">#${t.id} — ${assunto}</span>`,b,i===0,badge(sl,bc(sl)));
  }).join('');
  if (el.parentElement) el.parentElement.innerHTML=html;
}

async function carregarHistoricoContrato(el) {
  // Salvar referência ao container ANTES de qualquer await
  const container = document.getElementById('hist-content') || el?.parentElement;
  if (!container) return;

  if (!dadosAtual?.contrato_id) {
    container.innerHTML = '<div class="empty">Sem dados de contrato</div>';
    return;
  }

  const cid = String(dadosAtual.contrato_id);

  let hist = [];
  // Mostrar loading
  container.innerHTML = '<div class="empty">⏳ Buscando histórico...</div>';

  // Tentativa 1: filtrar por id_contrato (v1.7.6 — aumentado pra 30 registros)
  try {
    const r1 = await ixcGet('cliente_contrato_historico', {
      qtype: 'cliente_contrato_historico.id_contrato',
      query: cid, oper: '=', page: '1', rp: '30',
      sortname: 'cliente_contrato_historico.id', sortorder: 'desc'
    });
    console.log('[HIST] id_contrato → total:', r1?.total, 'regs:', r1?.registros?.length);
    if (r1?.registros?.length) hist = r1.registros;
  } catch(e) { console.warn('[HIST] erro 1:', e.message); }

  // Tentativa 2: filtrar por id_cliente_contrato
  if (!hist.length) {
    try {
      const r2 = await ixcGet('cliente_contrato_historico', {
        qtype: 'cliente_contrato_historico.id_cliente_contrato',
        query: cid, oper: '=', page: '1', rp: '30',
        sortname: 'cliente_contrato_historico.id', sortorder: 'desc'
      });
      if (r2?.registros?.length) hist = r2.registros;
    } catch(e) { console.warn('[HIST] erro 2:', e.message); }
  }

  // Reduzir ao mês passado e atual
  const _iniHist = new Date(); _iniHist.setDate(1); _iniHist.setMonth(_iniHist.getMonth()-1); _iniHist.setHours(0,0,0,0);
  hist = hist.filter(h => {
    const raw = (h.data || h.data_alteracao || '').toString().replace(' ','T');
    const dt = new Date(raw);
    return !isNaN(dt.getTime()) && dt >= _iniHist;
  });

  if (!hist.length) {
    container.innerHTML = '<div class="empty">Sem alterações no mês passado/atual</div>';
    return;
  }

  function buildHistItem(h,i) {
    const data    = fmt(h.data||h.data_alteracao)||'—';
    const tipo    = h.tipo||h.tipo_historico||h.acao||null;
    const resp    = h.nome_usuario||h.usuario||h.responsavel||h.nome_responsavel||null;
    const campo   = h.campo||h.descricao||null;
    const antes   = h.valor_anterior||h.antes||null;
    const depois  = h.valor_novo||h.depois||null;
    const hist_tx = h.historico||h.texto||h.mensagem||null;
    let b = mrow('Data', data)
          + mrow('Tipo', tipo)
          + mrow('Responsável', resp)
          + mrow('Campo', campo)
          + mrow('Antes', antes)
          + mrow('Depois', depois);
    if (hist_tx) b += infoBox('Histórico', hist_tx);
    const sub = campo || tipo || 'Alteração';
    return item(`hist-${i}`, `<span class="item-title">${data}</span><span class="item-sub">${sub}</span>`, b, false, '');
  }

  container.innerHTML = hist.map(buildHistItem).join('');
}

async function carregarNegociacoes(el) {
  const cl = dadosAtual.cliente;
  const res = await ixcGet('crm_negociacoes',{
    qtype:'crm_negociacoes.id_cliente', query:String(cl.id),
    oper:'=', page:'1', rp:'10',
    sortname:'crm_negociacoes.id', sortorder:'desc'
  });
  const negs = res?.registros||[];
  if (!negs.length) { el.parentElement.innerHTML='<div class="empty">Nenhuma negociação</div>'; return; }
  let html=negs.map((n,i)=>{
    let b=mrow('Data',fmt(n.data))+mrow('Status',n.status,bc(n.status))
         +mrow('Situação', n.descricao_status||n.status_descricao||n.situacao||null)
         +mrow('Plano',n.nome_plano)+mrow('Atendente',n.nome_atendente);
    if(n.observacao||n.descricao) b+=infoBox('Observação',n.observacao||n.descricao);
    return item(`neg-${i}`,`<span class="item-title">${n.nome_plano||'#'+n.id}</span><span class="item-sub">${fmt(n.data)||'—'}</span>`,b,i===0,badge(n.status,bc(n.status)));
  }).join('');
  el.parentElement.innerHTML=html;
}

async function carregarProdutos(el) {
  const res = await ixcGet('vd_contratos_produtos',{
    qtype:'vd_contratos_produtos.id_contrato', query:String(dadosAtual.contrato_id),
    oper:'=', page:'1', rp:'20',
    sortname:'vd_contratos_produtos.id', sortorder:'asc'
  });
  const prods = res?.registros||[];
  if (!prods.length) { el.parentElement.innerHTML='<div class="empty">Nenhum produto</div>'; return; }
  let html=prods.map((p,i)=>{
    let b=mrow('Produto',p.descricao||p.nome_produto)+mrow('Quantidade',p.quantidade)
         +mrow('Valor unit.',p.valor_unitario?'R$ '+p.valor_unitario:null)
         +mrow('Valor total',p.valor_total?'R$ '+p.valor_total:null)
         +mrow('Status',p.status,bc(p.status));
    return item(`prod-${i}`,`<span class="item-title">${p.descricao||p.nome_produto||'Produto #'+p.id}</span>`,b,false,p.valor_total?badge('R$ '+p.valor_total,'cinza'):'');
  }).join('');
  el.parentElement.innerHTML=html;
}

async function carregarTVSVA(el) {
  // v1.7.5 — proteger contra elemento removido do DOM durante carregamento
  if (!el || !el.parentElement) {
    console.warn('[IXC] carregarTVSVA: elemento alvo não está mais no DOM, abortando');
    return;
  }
  const cl  = dadosAtual.cliente;
  const cid = String(dadosAtual.contrato_id);
  const clid = String(cl.id);

  // Tentar múltiplos campos possíveis em sequência
  async function buscarTV() {
    const tentativas = [
      {qtype:'tv_usuarios.id_cliente_contrato', query:cid},
      {qtype:'tv_usuarios.id_contrato',         query:cid},
      {qtype:'tv_usuarios.id_cliente',          query:clid},
    ];
    for (const t of tentativas) {
      try {
        const r = await ixcGet('tv_usuarios', {...t, oper:'=', page:'1', rp:'10', sortname:'tv_usuarios.id', sortorder:'asc'});
        if (r?.registros?.length) return r.registros;
        if (r?.total > 0)         return r.registros || [];
      } catch(e) {}
    }
    return [];
  }

  async function buscarSVA() {
    const tentativas = [
      {qtype:'sva_usuarios.id_cliente_contrato', query:cid},
      {qtype:'sva_usuarios.id_contrato',         query:cid},
      {qtype:'sva_usuarios.id_cliente',          query:clid},
    ];
    for (const t of tentativas) {
      try {
        const r = await ixcGet('sva_usuarios', {...t, oper:'=', page:'1', rp:'10', sortname:'sva_usuarios.id', sortorder:'asc'});
        if (r?.registros?.length) return r.registros;
        if (r?.total > 0)         return r.registros || [];
      } catch(e) {}
    }
    return [];
  }

  const [tvs, svas] = await Promise.all([buscarTV(), buscarSVA()]);

  if (!tvs.length&&!svas.length) { el.parentElement.innerHTML='<div class="empty">Nenhum serviço TV/SVA</div>'; return; }

  let html='';
  if (tvs.length>0) {
    html+=secT('TV');
    html+=tvs.map((t,i)=>{
      let b=mrow('Login',      t.login||t.usuario||t.login_tv)
           +mrow('Senha',      t.senha||t.password)
           +mrow('Status',     t.status,bc(t.status))
           +mrow('Plataforma', t.descricao_plataforma||t.plataforma||t.nome_plataforma||null)
           +mrow('Plano',      t.nome_plano||t.descricao_plano||t.plano)
           +mrow('Servidor',   t.servidor||t.host||null)
           +mrow('Validade',   fmt(t.data_validade||t.validade||null))
           +mrow('Observação', t.obs||t.observacao||null);
      const titulo=t.login||t.usuario||t.login_tv||('TV #'+t.id);
      return item(`tv-${i}`,`<span class="item-title">${titulo}</span>`,b,i===0,badge(t.status,bc(t.status)));
    }).join('');
  }
  if (svas.length>0) {
    html+=secT('SVA');
    html+=svas.map((s,i)=>{
      let b=mrow('Login',   s.login||s.usuario)
           +mrow('Senha',   s.senha||s.password)
           +mrow('Status',  s.status,bc(s.status))
           +mrow('Serviço', s.nome_sva||s.descricao||s.id_sva)
           +mrow('Validade',fmt(s.data_validade||null));
      return item(`sva-${i}`,`<span class="item-title">${s.nome_sva||s.login||'SVA #'+s.id}</span>`,b,false,badge(s.status,bc(s.status)));
    }).join('');
  }
  // v1.7.5 — revalida antes de escrever (pode ter sido removido durante o await)
  if (!el.parentElement) return;
  el.parentElement.innerHTML=html;
}

// ── Boleto / PIX ──────────────────────────────
window.carregarBoleto = async function(titulo_id, idx) {
  const container = document.getElementById(`boleto-btns-${titulo_id}`);
  const btn = container ? container.querySelector('button[data-action="boleto"]') : null;
  if (btn) { btn.textContent='⏳ Buscando...'; btn.disabled=true; }
  try {
    const [resBol,resPix] = await Promise.allSettled([
      fetch(WEBHOOK_ACOES,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({acao:'boleto',titulo_id:String(titulo_id),token:sessaoAtual?.token})}).then(r=>r.json()),
      fetch(WEBHOOK_ACOES,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({acao:'pix',titulo_id:String(titulo_id),token:sessaoAtual?.token})}).then(r=>r.json())
    ]);
    // v1.8.4 — formato atual do webhook: boleto_base64 / raw.linha_digitavel / pix_copia_cola / qr_code
    const bol = resBol.status==='fulfilled' ? resBol.value : null;
    const pix = resPix.status==='fulfilled' ? resPix.value : null;
    const base64 = bol?.boleto_base64 || null;
    const linha  = bol?.raw?.linha_digitavel || bol?.raw?.registros?.[0]?.linha_digitavel || null;
    const email  = dadosAtual?.cliente?.email || '';

    let html='';
    if (base64) {
      const blobUrl = 'data:application/pdf;base64,' + base64;
      html += `<a class="btn-sm btn-blue" href="${blobUrl}" download="boleto_${titulo_id}.pdf">📄 Baixar boleto PDF</a>`;
    }
    if (linha) {
      html += `<div style="margin:6px 0;padding:6px 8px;background:var(--bg3);border-radius:6px;border:1px solid var(--b)">
        <div style="font-size:9px;color:var(--tx3);font-family:var(--font-head);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Linha digitável</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--tx);word-break:break-all;line-height:1.5">${linha}</div>
        <button class="btn-sm btn-gray" style="margin-top:6px" data-action="pix" data-p="${linha}">📋 Copiar linha dig.</button>
      </div>`;
    }
    if (pix?.pix_copia_cola) html+=`<button class="btn-sm btn-green" data-action="pix" data-p="${pix.pix_copia_cola}">⚡ Copiar PIX</button>`;
    if (pix?.qr_code) html+=`<div style="margin-top:8px"><img src="data:image/png;base64,${pix.qr_code}" style="width:120px;height:120px;border-radius:6px"></div>`;
    if (!base64 && !linha && !pix?.pix_copia_cola) html='<div style="color:var(--y);font-size:11px;margin-bottom:6px">Boleto/PIX não disponível para este título</div>';
    html += `<button class="btn-sm btn-gray" data-action="enviar-boleto-email" data-p="${titulo_id}" data-p2="${email}">✉ Enviar por e-mail</button>`;

    if (container) container.innerHTML=html;
  } catch(e) {
    if (container) container.innerHTML='<div style="color:#e05252;font-size:11px">Erro ao carregar boleto</div>';
  }
};

// ── OLT Cloud ─────────────────────────────────
function atualizarOLTStatus(msg,cor) {
  document.querySelectorAll('.olt-section').forEach(el=>{
    el.innerHTML=`<div class="sec-title">OLT Cloud</div><div class="olt-status-msg ${cor||'cinza'}">${msg}</div>`;
  });
}

// fmtOLT já declarada no topo (dedup v1.6)

async function buscarOLT(logins) {
  try {
    const OLT_BASE='https://carajas.oltcloud.co/api/v2';
    const oltSessao = await new Promise(r=>chrome.storage.local.get(['olt_sessao'],d=>r(d.olt_sessao||null)));
    if (!oltSessao) { atualizarOLTStatus('⚙ Configure o acesso OLT Cloud — clique em ⚡ OLT','amarelo'); return; }

    let oltToken='';
    try {
      const refreshRes = await fetch('https://carajas.oltcloud.co/api/token/refresh',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({refresh:oltSessao.refresh})
      });
      if (refreshRes.ok) { const rd=await refreshRes.json(); oltToken=rd?.access||''; }
    } catch(e) {}

    if (!oltToken) {
      try {
        const loginRes = await fetch('https://carajas.oltcloud.co/api/token',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({username:oltSessao.username,password:oltSessao.password})
        });
        if (!loginRes.ok) { atualizarOLTStatus(`❌ Falha no login OLT (HTTP ${loginRes.status})`,'vermelho'); return; }
        const ld=await loginRes.json(); oltToken=ld?.access||'';
        if (oltToken&&ld?.refresh) await new Promise(r=>chrome.storage.local.set({olt_sessao:{...oltSessao,access:oltToken,refresh:ld.refresh}},r));
      } catch(e) { atualizarOLTStatus(`❌ Erro de conexão OLT: ${e.message}`,'vermelho'); return; }
    }

    if (!oltToken) { atualizarOLTStatus('❌ Token OLT Cloud inválido','vermelho'); return; }

    const hdrs={'Authorization':`Bearer ${oltToken}`,'Content-Type':'application/json'};
    const olt_cloud={};
    const erros=[];

    for (const l of logins) {
      try {
        const pppoe=encodeURIComponent(l.login);
        const resEq=await fetch(`${OLT_BASE}/ftth/equipment/list?client_pppoe=${pppoe}`,{headers:hdrs});
        if (!resEq.ok) { erros.push(`${l.login}: HTTP ${resEq.status}`); continue; }
        const eqData=await resEq.json();
        const eq=eqData?.results?.[0];
        if (!eq?.id) { erros.push(`${l.login}: não encontrado no OLT Cloud`); continue; }

        // Buscar detalhes + alertas + histórico + PON realtime em paralelo
        // v1.7.5 — wrapper que silencia 404 (esperado quando não há alertas/dados)
        const fetchSilencioso = (url) => fetch(url, {headers:hdrs})
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);
        const [resDetail,resAlerts,resHistory,resDisable,resRealtime] = await Promise.allSettled([
          fetchSilencioso(`${OLT_BASE}/ftth/equipment/${eq.id}`),
          fetchSilencioso(`${OLT_BASE}/client/device_alert?pppoe=${pppoe}`),
          fetchSilencioso(`${OLT_BASE}/ftth/equipment/${eq.id}/status_logs`),
          fetchSilencioso(`${OLT_BASE}/ftth/equipment/check_disable/${eq.id}`),
          Promise.resolve(null) // realtime será buscado com dados do equipment
        ]);

        const d=resDetail.status==='fulfilled'?resDetail.value?.equipment:null;
        if (!d) { erros.push(`${l.login}: sem detalhes`); continue; }

        // PON realtime com dados do equipment
        let realtimeData=null;
        if (d.olt_id&&d.slot&&d.pon) {
          try {
            const rr=await fetch(`${OLT_BASE}/ftth/equipment/realtime?olt_id=${d.olt_id}&slot=${d.slot}&pon=${d.pon}`,{headers:hdrs});
            if (rr.ok) realtimeData=await rr.json();
          } catch(e) {}
        }

        const alertsData  = resAlerts.status==='fulfilled'  ? resAlerts.value  : null;
        const historyData = resHistory.status==='fulfilled' ? resHistory.value  : null;
        const disableData = resDisable.status==='fulfilled' ? resDisable.value  : null;

        const alertas=(alertsData?.alerts||[]).filter(a=>!a.ignored).slice(0,5).map(a=>({
          tipo:a.alert_type, descricao:a.description, inicio:a.initial_date,
          fim:a.end_date, cto:a.cto_name||null
        }));

        const historico_status=(historyData?.results||[]).slice(0,20).map(h=>({data:h.date,status:h.status}));
        const sem_energia=historico_status.filter(h=>h.status==='Sem Energia').length;

        const pon_realtime=realtimeData?.results||[];
        const pon_total=pon_realtime.length;
        const pon_online=pon_realtime.filter(o=>o.status==='Online').length;
        const pon_offline=pon_total-pon_online;
        const problema_coletivo=pon_total>0&&(pon_offline/pon_total)>0.3;

        olt_cloud[l.id]={
          eq_id:eq.id||null,
          status:d.status, modelo:d.model||null, serial:d.serial_number||null,
          olt:d.olt||null, olt_id:d.olt_id||null, slot:d.slot||null, pon:d.pon||null,
          slot_pon_onu:d['slot/pon/onu_id']||null,
          sinal_onu:d.device_rx??null, sinal_olt:d.olt_rx??null,
          temperatura:d.optical_module_temperature??null, tensao:d.optical_module_volt??null,
          corrente:d.optical_module_current??null, distancia:d.optical_module_distance??null,
          ultimo_alarme:d.optical_module_last_alarm||null, uptime:d.optical_module_uptime||null,
          ultima_desconexao:d.last_disconnection||null, online_desde:d.uptime_since||null,
          intermitencia:d.optical_module_intermittency||false,
          onu_desabilitada:disableData?.disable===true,
          alertas, historico_status, sem_energia,
          pon_total, pon_online, pon_offline, problema_coletivo
        };
      } catch(e) { erros.push(`${l.login}: ${e.message}`); }
    }

    // Salvar olt_cloud em dadosAtual para o copiar tudo
    if (dadosAtual) dadosAtual._olt_cloud = olt_cloud;

    // Mostrar erros + botão fallback IXC
    if (erros.length) {
      erros.forEach(erro=>{
        logins.forEach((l,i)=>{
          if (erro.includes(l.login)) {
            const bodyEl=document.getElementById(`body-login-${i}`);
            if (!bodyEl) return;
            const s=bodyEl.querySelector('.olt-section');
            if (s) {
              s.innerHTML=`<div class="sec-title">OLT Cloud</div>
                <div class="olt-status-msg vermelho">❌ ${erro}</div>
                <div class="btns" style="margin-top:6px">
                  <button class="btn-sm btn-yellow" data-action="potencia-onu" data-p="${l.id}" data-p2="${l.login}">📡 Consultar potência via IXC</button>
                </div>`;
            }
          }
        });
      });
    }

    // Atualizar cards
    logins.forEach((l,i)=>{
      const olt=olt_cloud[l.id];
      if (!olt) return;
      const bodyEl=document.getElementById(`body-login-${i}`);
      if (!bodyEl) return;
      let s=bodyEl.querySelector('.olt-section');
      if (!s) { s=document.createElement('div'); s.className='olt-section'; const btns=bodyEl.querySelector('.btns'); if(btns)bodyEl.insertBefore(s,btns); else bodyEl.appendChild(s); }

      const sid=`s${i}`;

      // Adicionar botão reboot agora que temos os dados da OLT
      const rebootSlot = document.getElementById(`btn-reboot-${i}`);
      if (rebootSlot && olt.eq_id) {
        rebootSlot.innerHTML = `<button class="btn-sm btn-yellow" data-action="reboot-onu" data-p="${olt.eq_id||''}" data-p2="${l.login}" data-p3="${dadosAtual?.contrato_id||''}">🔄 Reboot ONU</button>`;
      }

      let oltHtml=secTCopy('OLT Cloud — Sinal em tempo real','olt-sinal-'+sid)+`<div id="olt-sinal-${sid}">`;
      oltHtml+=`<div class="olt-grid">
        <div class="olt-item ${sinalCls(olt.sinal_onu)}"><div class="olt-label">RX ONU</div><div class="olt-val">${fmtOLT(olt.sinal_onu,2,' dBm')}</div></div>
        <div class="olt-item ${sinalCls(olt.sinal_olt)}"><div class="olt-label">RX OLT</div><div class="olt-val">${fmtOLT(olt.sinal_olt,2,' dBm')}</div></div>
        <div class="olt-item ${tempCls(olt.temperatura)}"><div class="olt-label">Temperatura</div><div class="olt-val">${fmtOLT(olt.temperatura,1,'°C')}</div></div>
        <div class="olt-item cinza"><div class="olt-label">Tensão</div><div class="olt-val">${fmtOLT(olt.tensao,2,' V')}</div></div>
        <div class="olt-item cinza"><div class="olt-label">Corrente</div><div class="olt-val">${fmtOLT(olt.corrente,1,' mA')}</div></div>
        <div class="olt-item cinza"><div class="olt-label">Distância</div><div class="olt-val">${fmtOLT(olt.distancia,0,' m')}</div></div>
      </div>`;
      oltHtml+='</div>';

      oltHtml+=secTCopy('Status OLT','olt-status-'+sid)+`<div id="olt-status-${sid}">`;
      if (olt.onu_desabilitada) oltHtml+='<div class="olt-alarme vermelho">🚫 ONU desabilitada na OLT</div>';
      if (olt.ultimo_alarme) { const clr=olt.ultimo_alarme.toLowerCase().includes('energia')||olt.ultimo_alarme.toLowerCase().includes('loss')?'vermelho':'amarelo'; oltHtml+=`<div class="olt-alarme ${clr}">⚡ ${olt.ultimo_alarme}</div>`; }
      if (olt.intermitencia) oltHtml+='<div class="olt-alarme vermelho">⚠ Intermitência detectada</div>';
      if (olt.pon_total>0) { const pct=Math.round((olt.pon_offline/olt.pon_total)*100); oltHtml+=`<div class="olt-alarme ${olt.problema_coletivo?'vermelho':'verde'}">📡 PON: ${olt.pon_online}/${olt.pon_total} online${olt.problema_coletivo?' — ⚠ '+pct+'% offline':''}</div>`; }

      oltHtml+=mrow('Status OLT',olt.status,bc(olt.status));
      oltHtml+=mrow('Modelo',olt.modelo);
      oltHtml+=mrow('OLT',olt.olt);
      oltHtml+=mrow('Slot/PON/ONU',olt.slot_pon_onu);
      oltHtml+=mrow('Online desde',fmt(olt.online_desde));
      oltHtml+=mrow('Última descon.',fmt(olt.ultima_desconexao));

      oltHtml+='</div>';
      if (olt.historico_status?.length>0) {
        oltHtml+=secTCopy('Histórico de status ONU','olt-hist-'+sid)+`<div id="olt-hist-${sid}"`+'>';
        oltHtml+='<div style="display:flex;flex-wrap:wrap;gap:3px;margin:4px 0">';
        olt.historico_status.slice(0,15).forEach(h=>{
          const isOn=h.status==='Online',isSE=h.status==='Sem Energia';
          const bg=isOn?'#0a2318':isSE?'#220a0a':'#221600';
          const brd=isOn?'#1a5c3a':isSE?'#5c1a1a':'#5c3e00';
          const clr=isOn?'#3bc48a':isSE?'#e05252':'#f0a500';
          oltHtml+=`<span title="${h.data}" style="font-size:9px;padding:2px 6px;border-radius:10px;background:${bg};border:1px solid ${brd};color:${clr}">${h.status}</span>`;
        });
        oltHtml+='</div>';
        if (olt.sem_energia>0) oltHtml+=`<div style="font-size:10px;color:#f0a500;margin-top:2px">⚡ ${olt.sem_energia} evento(s) Sem Energia</div>`;
        oltHtml+='</div>';
      }

      const alertasAtivos=olt.alertas?.filter(a=>!a.ignorado)||[];
      if (alertasAtivos.length>0) {
        oltHtml+=secTCopy('Alertas OLT Cloud','olt-alert-'+sid)+`<div id="olt-alert-${sid}"`+'>';
        alertasAtivos.forEach(a=>{
          const tl={cto_loss:'CTO Loss',onu_loss:'ONU Loss',pon_loss:'PON Loss',no_power:'Sem Energia'}[a.tipo]||a.tipo;
          oltHtml+=`<div style="padding:5px 0;border-bottom:1px solid var(--color-border-tertiary);font-size:11px">
            <div style="font-weight:600;color:#e05252">${tl}${a.cto?' — '+a.cto:''}</div>
            <div style="opacity:.8;margin-top:1px">${a.descricao||''}</div>
            <div style="opacity:.6;font-size:10px;margin-top:1px">${a.inicio||''} ${a.fim?'→ '+a.fim:'(em aberto)'}</div>
          </div>`;
        });
        oltHtml+='</div>';
      }

      s.innerHTML=oltHtml;
    });

  } catch(e) { console.warn('Erro OLT Cloud:',e); atualizarOLTStatus(`❌ Erro: ${e.message}`,'vermelho'); }
}

// ── Busca ──────────────────────────────────────
elInput.addEventListener('keydown', e=>{ if(e.key==='Enter') buscar(); });
elBtn.addEventListener('click', buscar);

function formatarCPFCNPJ(v) {
  const n = v.replace(/\D/g,'');
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

async function buscar() {
  let v=elInput.value.trim();
  if (!v) { elInput.focus(); return; }
  // Normalizar CPF/CNPJ sem pontuação
  const soNumeros=v.replace(/\D/g,'');
  if (soNumeros.length===11||soNumeros.length===14) {
    v = formatarCPFCNPJ(v);
    elInput.value = v;
  }
  setState('loading'); elBtn.disabled=true; elLast.textContent=v;
  const bcBar = document.getElementById('cliente-ativo');
  if (bcBar) bcBar.style.display = 'none';
  try {
    const ehCPF=soNumeros.length===11||soNumeros.length===14;
    if (ehCPF) {
      const res=await fetch(WEBHOOK_CPF,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cpf:v})});
      if (!res.ok) throw new Error('HTTP '+res.status);
      const data=await res.json();
      if (!data.ok) { elErrMsg.textContent=data.erro||'Nenhum cliente encontrado.'; setState('error'); return; }
      await Logger.registrarLog(sessaoAtual,'CONSULTA_CPF',{detalhes:{cpf:v.replace(/\d/g,'*'),total:data.total}});
      if (data.total===1) { elInput.value=data.contratos[0].contrato_id; await buscarContrato(data.contratos[0].contrato_id); }
      else renderSelecao(data.contratos);
    } else {
      await buscarContrato(v);
    }
  } catch(e) { elErrMsg.textContent='Falha ao conectar.'; setState('error'); console.error(e); }
  finally { elBtn.disabled=false; }
}

// ── Cache de consulta (reduz tempo em buscas repetidas) ──
const CACHE_TTL_MS = 180000; // 3 min
const _cacheKey = id => 'ixc_cache_' + id;
function _getCache(id){ return new Promise(r=>chrome.storage.local.get([_cacheKey(id)], d=>r(d[_cacheKey(id)]||null))); }
function _setCache(id, data){ try{ chrome.storage.local.set({ [_cacheKey(id)]: { ts: Date.now(), data } }); }catch(e){} }
function invalidarCache(id){ try{ chrome.storage.local.remove(_cacheKey(id)); }catch(e){} }

function indicadorTempo(ms, doCache) {
  const txt = doCache ? '⚡ cache' : '⚡ ' + (ms/1000).toFixed(2) + 's';
  const el = document.createElement('div');
  el.id = 'tempo-resp';
  el.style.cssText = 'text-align:right;font-size:9px;color:var(--tx3);margin:0 2px 3px;font-family:var(--font-mono);opacity:.65';
  el.textContent = txt;
  elRes.prepend(el);
}

function indicadorCache(id, ts) {
  const seg = Math.max(0, Math.round((Date.now()-ts)/1000));
  const idade = seg < 60 ? seg+'s' : Math.round(seg/60)+'min';
  const bar = document.createElement('div');
  bar.id = 'cache-bar';
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg3);border:1px solid var(--b2);border-radius:6px;padding:5px 10px;margin-bottom:6px;font-size:10px;color:var(--tx3)';
  bar.innerHTML = `<span>⚡ Dados em cache (há ${idade})</span><button class="btn-sm btn-gray" data-action="atualizar-cache" data-p="${id}" style="font-size:10px;padding:2px 8px">↻ Atualizar</button>`;
  elRes.prepend(bar);
}

async function buscarContrato(id, force=false) {
  if (!force) {
    const c = await _getCache(id);
    if (c && c.data?.ok && (Date.now()-c.ts) < CACHE_TTL_MS) {
      render(c.data);
      indicadorCache(id, c.ts);
      indicadorTempo(0, true);
      return;
    }
  }
  const t0 = performance.now();
  const res=await fetch(WEBHOOK_CONTRATO,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contrato_id:String(id)})});
  if (!res.ok) throw new Error('HTTP '+res.status);
  const data=await res.json();
  const ms = performance.now() - t0;
  if (!data.ok) { elErrMsg.textContent=data.erro||'Contrato não encontrado.'; setState('error'); return; }
  _setCache(id, data);
  render(data);
  indicadorTempo(ms, false);
}

// ── Start ──────────────────────────────────────
init();

// ═══════════════════════════════════════════════
// v1.5 — Novas ações
// ═══════════════════════════════════════════════

// ── Enviar boleto por e-mail ──────────────────
window.enviarBoletoEmail = function(titulo_id, email) {
  const dest = email || dadosAtual?.cliente?.email || '(e-mail cadastrado no IXC)';
  confirmar('Enviar boleto por e-mail',
    `Confirma o envio do boleto #${titulo_id} para <strong>${dest}</strong>?<br><br><span style="font-size:10px;color:var(--tx3)">O boleto será enviado para o e-mail cadastrado na ficha do cliente. Para alterar, edite a ficha no IXC antes.</span>`,
    async () => {
      try {
        toast('Enviando boleto...','');
        const res = await fetch(WEBHOOK_ACOES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acao: 'enviar_boleto_email', usar_token_master: usarTokenMaster(),
            titulo_id: String(titulo_id),
            token: sessaoAtual?.token
          })
        }).then(r => r.json());

        // v1.8.4 — detecção de sucesso ampla (get_boleto tipo 'mail' nem sempre devolve marcador)
        const tipoEnv = (res?.type || res?.tipo || '').toLowerCase();
        const msgEnv  = res?.mensagem || res?.message || res?.msg || '';
        const okEnv   = res?.ok === true || tipoEnv==='success' || tipoEnv==='sucesso'
                      || (msgEnv && !tipoEnv && !msgEnv.toLowerCase().includes('erro') && !msgEnv.toLowerCase().includes('falha'));

        if (okEnv) {
          await Logger.registrarLog(sessaoAtual,'ENVIAR_BOLETO_EMAIL',{
            contrato_id: dadosAtual?.contrato_id,
            cliente_nome: dadosAtual?.cliente?.nome,
            cliente_id: dadosAtual?.cliente?.id,
            sucesso: true,
            detalhes: { titulo_id, email: dest, resultado: msgEnv }
          });
          toast('✓ ' + (msgEnv||'Boleto enviado!'),'ok');
        } else {
          await Logger.registrarLog(sessaoAtual,'ENVIAR_BOLETO_EMAIL',{
            contrato_id: dadosAtual?.contrato_id, sucesso: false,
            detalhes: { titulo_id }, erro: msgEnv || res?.erro
          });
          toast('❌ ' + (msgEnv||res?.erro||'Falha ao enviar'),'err');
        }
      } catch(e) {
        toast(traduzirErro(e), 'err');
      }
    }
  );
};

// ── Consultar potência ONU via IXC (fallback OLT Cloud) ──
window.consultarPotenciaONU = async function(login_id, login) {
  toast('Consultando IXC...','');
  try {
    const res = await fetch(WEBHOOK_ACOES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'botao_potencia_onu',
        login_id: String(login_id),
        token: sessaoAtual?.token
      })
    }).then(r => r.json());

    if (!res?.ok) { toast('❌ '+(res?.erro||'Falha'),'err'); return; }

    // Renderizar resultado em modal simples
    const r = res.resultado || {};
    const m = document.createElement('div');
    m.className='confirm-modal';
    let html = `<div class="confirm-box" style="max-width:380px"><h3>📡 Potência ONU — ${login}</h3>`;
    html += '<div style="font-family:var(--font-mono);font-size:11px;color:var(--tx);background:var(--bg3);padding:10px;border-radius:6px;border:1px solid var(--b);max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">';
    if (typeof r === 'string') {
      html += r;
    } else {
      html += JSON.stringify(r, null, 2);
    }
    html += '</div><div class="confirm-btns"><button class="btn-sm btn-blue" id="pot-fechar">Fechar</button></div></div>';
    m.innerHTML = html;
    document.body.appendChild(m);
    m.querySelector('#pot-fechar').onclick = () => m.remove();
  } catch(e) {
    toast(traduzirErro(e), 'err');
  }
};

// ── Modal de Agendamento OS ───────────────────
let agendarOsAtual = null;
let agendarTecSelecionado = null;
let agendarTecTimeout = null;

window.abrirAgendarOS = function(os_id, assunto) {
  agendarOsAtual = os_id;
  agendarTecSelecionado = null;
  document.getElementById('agendar-info').innerHTML =
    `OS <strong>#${os_id}</strong> — ${assunto || 'Sem assunto'}`;
  document.getElementById('agendar-inicio').value = '';
  document.getElementById('agendar-fim').value = '';
  document.getElementById('agendar-tec').value = '';
  document.getElementById('agendar-tec-list').style.display = 'none';
  document.getElementById('agendar-tec-list').innerHTML = '';
  document.getElementById('agendar-tec-selected').innerHTML = '';
  document.getElementById('agendar-msg').value = '';
  document.getElementById('agendar-erro').style.display = 'none';
  document.getElementById('agendar-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('agendar-inicio').focus(), 100);
};

document.getElementById('agendar-cancelar').addEventListener('click', () => {
  document.getElementById('agendar-modal').style.display = 'none';
  agendarOsAtual = null;
  agendarTecSelecionado = null;
});

// Atalhos rápidos de data
document.querySelectorAll('#agendar-modal .btn-rapido[data-rapido]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    const tipo = btn.getAttribute('data-rapido');
    const d = new Date();
    if (tipo === 'hoje-tarde') {
      d.setHours(14, 0, 0, 0);
    } else if (tipo === 'amanha-manha') {
      d.setDate(d.getDate()+1); d.setHours(8, 0, 0, 0);
    } else if (tipo === 'amanha-tarde') {
      d.setDate(d.getDate()+1); d.setHours(14, 0, 0, 0);
    }
    document.getElementById('agendar-inicio').value = toDatetimeLocal(d);
    // Default fim = +2h
    const fim = new Date(d.getTime() + 2*60*60*1000);
    document.getElementById('agendar-fim').value = toDatetimeLocal(fim);
  });
});

// Atalhos de duração
document.querySelectorAll('#agendar-modal .btn-rapido[data-dur]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    const minutos = parseInt(btn.getAttribute('data-dur'));
    const inicioVal = document.getElementById('agendar-inicio').value;
    if (!inicioVal) { toast('Defina o início primeiro','err'); return; }
    const inicio = new Date(inicioVal);
    const fim = new Date(inicio.getTime() + minutos*60*1000);
    document.getElementById('agendar-fim').value = toDatetimeLocal(fim);
  });
});

function toDatetimeLocal(d) {
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Autocomplete de técnicos — debounce 300ms
document.getElementById('agendar-tec').addEventListener('input', e => {
  const termo = e.target.value.trim();
  agendarTecSelecionado = null;
  document.getElementById('agendar-tec-selected').innerHTML = '';
  clearTimeout(agendarTecTimeout);
  if (termo.length < 2) {
    document.getElementById('agendar-tec-list').style.display = 'none';
    return;
  }
  agendarTecTimeout = setTimeout(() => buscarTecnicos(termo), 300);
});

async function buscarTecnicos(termo) {
  const listEl = document.getElementById('agendar-tec-list');
  listEl.innerHTML = '<div class="tec-suggest-item" style="color:var(--tx3)">⏳ Buscando...</div>';
  listEl.style.display = 'block';
  try {
    const res = await fetch(WEBHOOK_ACOES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'buscar_tecnicos',
        extra: { termo },
        token: sessaoAtual?.token
      })
    }).then(r => r.json());

    const tecs = res?.tecnicos || [];
    if (!tecs.length) {
      listEl.innerHTML = '<div class="tec-suggest-item" style="color:var(--tx3)">Nenhum técnico encontrado</div>';
      return;
    }
    listEl.innerHTML = tecs.map(t =>
      `<div class="tec-suggest-item" data-tec-id="${t.id}" data-tec-nome="${t.nome.replace(/"/g,'&quot;')}">
        ${t.nome}<span class="tec-id">#${t.id}</span>
      </div>`
    ).join('');
  } catch(e) {
    listEl.innerHTML = `<div class="tec-suggest-item" style="color:var(--r)">Erro: ${e.message}</div>`;
  }
}

// Seleção de técnico via clique
document.getElementById('agendar-tec-list').addEventListener('click', e => {
  const item = e.target.closest('.tec-suggest-item[data-tec-id]');
  if (!item) return;
  const id = item.getAttribute('data-tec-id');
  const nome = item.getAttribute('data-tec-nome');
  agendarTecSelecionado = { id, nome };
  document.getElementById('agendar-tec').value = nome;
  document.getElementById('agendar-tec-list').style.display = 'none';
  document.getElementById('agendar-tec-selected').innerHTML =
    `<div class="tec-selected">✓ ${nome} <button title="Remover">×</button></div>`;
  document.getElementById('agendar-tec-selected').querySelector('button').onclick = () => {
    agendarTecSelecionado = null;
    document.getElementById('agendar-tec').value = '';
    document.getElementById('agendar-tec-selected').innerHTML = '';
  };
});

// Esconder lista ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.tec-suggest-wrap')) {
    document.getElementById('agendar-tec-list').style.display = 'none';
  }
});

// Confirmar agendamento
document.getElementById('agendar-confirmar').addEventListener('click', async () => {
  const erroEl = document.getElementById('agendar-erro');
  erroEl.style.display = 'none';

  const inicio = document.getElementById('agendar-inicio').value;
  const fim    = document.getElementById('agendar-fim').value;
  const msg    = document.getElementById('agendar-msg').value.trim();

  if (!inicio || !fim) { erroEl.textContent = 'Preencha início e fim.'; erroEl.style.display=''; return; }
  if (!agendarTecSelecionado) { erroEl.textContent = 'Selecione um técnico da lista.'; erroEl.style.display=''; return; }
  if (new Date(fim) <= new Date(inicio)) { erroEl.textContent = 'Fim deve ser depois do início.'; erroEl.style.display=''; return; }

  const data_inicio = inicio.replace('T',' ') + ':00';
  const data_fim    = fim.replace('T',' ') + ':00';

  const btn = document.getElementById('agendar-confirmar');
  btn.disabled = true; btn.textContent = 'Agendando...';

  try {
    const res = await fetch(WEBHOOK_ACOES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'agendar_os', usar_token_master: usarTokenMaster(),
        os_id: String(agendarOsAtual),
        extra: {
          data_inicio,
          data_fim,
          id_tecnico: agendarTecSelecionado.id,
          mensagem: msg
        },
        token: sessaoAtual?.token
      })
    }).then(r => r.json());

    if (res?.ok) {
      await Logger.registrarLog(sessaoAtual,'AGENDAR_OS',{
        contrato_id: dadosAtual?.contrato_id,
        cliente_nome: dadosAtual?.cliente?.nome,
        cliente_id: dadosAtual?.cliente?.id,
        sucesso: true,
        detalhes: {
          os_id: agendarOsAtual,
          data_inicio, data_fim,
          tecnico_id: agendarTecSelecionado.id,
          tecnico_nome: agendarTecSelecionado.nome
        }
      });
      toast('✓ OS agendada!','ok');
      document.getElementById('agendar-modal').style.display = 'none';
      // Recarregar contrato pra ver a OS atualizada
      invalidarCache(dadosAtual.contrato_id); setTimeout(() => buscarContrato(dadosAtual.contrato_id, true), 1500);
    } else {
      await Logger.registrarLog(sessaoAtual,'AGENDAR_OS',{
        contrato_id: dadosAtual?.contrato_id, sucesso: false,
        detalhes: { os_id: agendarOsAtual, usou_master: res?.usou_master }, erro: res?.mensagem || res?.erro
      });
      let msgErro = res?.mensagem || res?.erro || 'Falha ao agendar';
      if (res?.sugestao) msgErro += '\n\n💡 ' + res.sugestao;
      erroEl.textContent = '❌ ' + msgErro;
      erroEl.style.display = '';
    }
  } catch(e) {
    erroEl.textContent = 'Erro: ' + traduzirErro(e);
    erroEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '📅 Agendar';
  }
});

// ═══════════════════════════════════════════════
// v1.6 — Toggle de Token + Timer de Sessão
// ═══════════════════════════════════════════════

const elTokenToggle = document.getElementById('btn-token-toggle');
const elSessTempo   = document.getElementById('sessao-tempo');
const elAviso       = document.getElementById('sessao-aviso');
const elAvisoMin    = document.getElementById('sessao-aviso-min');
const elBtnEstender = document.getElementById('btn-estender');
const elBtnAvFechar = document.getElementById('btn-aviso-fechar');

async function carregarToggleToken() {
  // Carrega preferência salva (default: master)
  const r = await new Promise(res => chrome.storage.local.get(['ixc_modo_token'], d => res(d.ixc_modo_token)));
  modoToken = (r === 'meu') ? 'meu' : 'master';
  atualizarToggleUI();
}

function atualizarToggleUI() {
  if (!elTokenToggle) return;
  if (modoToken === 'master') {
    elTokenToggle.textContent = '🔓 master';
    elTokenToggle.classList.remove('modo-meu');
    elTokenToggle.classList.add('modo-master');
    elTokenToggle.title = 'Ações executadas com TOKEN MASTER. Clique para usar SEU token (registra como você no IXC).';
  } else {
    elTokenToggle.textContent = '👤 ' + (sessaoAtual?.usuario_nome?.split(' ')[0]?.toLowerCase() || 'meu');
    elTokenToggle.classList.remove('modo-master');
    elTokenToggle.classList.add('modo-meu');
    elTokenToggle.title = 'Ações registradas no IXC como VOCÊ. Clique para usar token master (se sua permissão API falhar).';
  }
}

if (elTokenToggle) {
  elTokenToggle.addEventListener('click', async () => {
    modoToken = (modoToken === 'master') ? 'meu' : 'master';
    await new Promise(r => chrome.storage.local.set({ ixc_modo_token: modoToken }, r));
    atualizarToggleUI();
    if (modoToken === 'meu') {
      toast('👤 Modo SEU token ativo. Se der erro de permissão, alterne para 🔓 master.','');
    } else {
      toast('🔓 Modo MASTER ativo','');
    }
  });
}

// ── Timer de sessão ──────────────────────────
function iniciarTimerSessao() {
  pararTimerSessao();
  avisoMostrado = false;
  atualizarTempoSessao(); // atualização imediata
  timerSessao = setInterval(atualizarTempoSessao, 30 * 1000); // a cada 30s
}

function pararTimerSessao() {
  if (timerSessao) { clearInterval(timerSessao); timerSessao = null; }
}

function fmtTempo(ms) {
  if (ms < 0) return '00:00';
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h${String(m).padStart(2,'0')}`;
  }
  return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

async function atualizarTempoSessao() {
  if (!sessaoAtual?.expira_em) return;
  const restante = sessaoAtual.expira_em - Date.now();

  if (restante <= 0) {
    // Sessão expirou — força logout
    pararTimerSessao();
    toast('⏰ Sessão expirada. Faça login novamente.','err');
    setTimeout(() => {
      Auth.clearSessao().then(() => {
        sessaoAtual = null; dadosAtual = null;
        if (elAviso) elAviso.style.display = 'none';
        mostrarLogin();
      });
    }, 1500);
    return;
  }

  if (elSessTempo) {
    elSessTempo.textContent = '⏱ ' + fmtTempo(restante);
    elSessTempo.classList.remove('alerta','critico');
    if (restante < 60 * 1000)        elSessTempo.classList.add('critico');
    else if (restante < AVISO_SESSAO_MIN * 60 * 1000) elSessTempo.classList.add('alerta');
  }

  // Mostrar banner quando entrar na faixa de 5min
  if (restante < AVISO_SESSAO_MIN * 60 * 1000 && !avisoMostrado) {
    avisoMostrado = true;
    if (elAviso) {
      elAviso.style.display = 'flex';
      atualizarBannerAviso(restante);
    }
  } else if (avisoMostrado && elAviso && elAviso.style.display !== 'none') {
    atualizarBannerAviso(restante);
  }
}

function atualizarBannerAviso(restanteMs) {
  if (!elAviso || !elAvisoMin) return;
  const min = Math.max(0, Math.ceil(restanteMs / 60000));
  elAvisoMin.textContent = min;
  if (restanteMs < 60 * 1000) elAviso.classList.add('critico');
  else elAviso.classList.remove('critico');
}

if (elBtnEstender) {
  elBtnEstender.addEventListener('click', async () => {
    const nova = await Auth.estenderSessao(ESTENDER_MIN);
    if (nova) {
      sessaoAtual = nova;
      avisoMostrado = false;
      if (elAviso) elAviso.style.display = 'none';
      atualizarTempoSessao();
      toast(`✓ Sessão estendida por +${ESTENDER_MIN}min`,'ok');
    }
  });
}

if (elBtnAvFechar) {
  elBtnAvFechar.addEventListener('click', () => {
    if (elAviso) elAviso.style.display = 'none';
  });
}

// Esconder o aviso e parar o timer no logout (já chamado pelo elBtnLogout existente)
const _origLogout = elBtnLogout.onclick;
// Garantir limpeza ao deslogar
document.getElementById('btn-logout').addEventListener('click', () => {
  pararTimerSessao();
  if (elAviso) elAviso.style.display = 'none';
});

// ═══════════════════════════════════════════════
// v1.7 — Versão visível no logo
// ═══════════════════════════════════════════════
(function injetarVersao() {
  try {
    const mf = chrome.runtime.getManifest();
    const logo = document.getElementById('logo-ixc');
    if (logo && mf?.version) {
      logo.title = `IXC Lookup v${mf.version}`;
    }
  } catch(e) { /* ignora — manifest sempre acessível */ }
})();
