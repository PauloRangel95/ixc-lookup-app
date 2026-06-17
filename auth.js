(function() {
const WEBHOOK_LOGIN = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-login';
const SESSAO_HORAS  = 4; // 4h por sessão (almoço-12h / saída-18h)

async function getSessao() {
  return new Promise(resolve => {
    chrome.storage.local.get(['ixc_sessao'], r => resolve(r.ixc_sessao || null));
  });
}

async function setSessao(dados) {
  return new Promise(resolve => {
    chrome.storage.local.set({ ixc_sessao: dados }, resolve);
  });
}

// v1.7 — limpeza total ao deslogar (não deixa rastro do colaborador)
// Mantém só configurações de UI: tema, faixas de sinal, sessão OLT (texto puro por escolha)
async function clearSessao() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, all => {
      const PRESERVAR = ['ixc_tema', 'ixc_faixas_olt', 'olt_sessao'];
      const aRemover = Object.keys(all).filter(k => !PRESERVAR.includes(k));
      if (aRemover.length === 0) return resolve();
      chrome.storage.local.remove(aRemover, resolve);
    });
  });
}

// SHA-256 via Web Crypto API
async function sha256(text) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function fazerLogin(login, senha) {
  const senhaHash = await sha256(senha);

  let res;
  try {
    res = await fetch(WEBHOOK_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, senha_hash: senhaHash })
    });
  } catch(e) {
    throw new Error('Sem conexão com o servidor. Verifique sua internet.');
  }

  if (!res.ok) throw new Error(`Servidor retornou ${res.status}. Tente novamente.`);

  let data;
  try { data = await res.json(); }
  catch(e) { throw new Error('Resposta inválida do servidor.'); }
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) {} }

  if (!data?.ok) throw new Error(data?.erro || 'Erro ao fazer login.');

  const agora = Date.now();
  const sessao = {
    usuario_id:    data.usuario_id,
    usuario_nome:  data.usuario_nome,
    usuario_login: data.usuario_login,
    usuario_email: data.usuario_email || '',
    // Grupo de usuário do IXC (1 = técnico, 2 = atendente) — usado no filtro da Gestão
    id_grupo:      data.id_grupo ?? data.grupo_id ?? data.id_grupo_usuario ?? null,
    token:         data.token,
    token_proprio: data.token_proprio,
    login_em:      new Date(agora).toISOString(),
    expira_em:     agora + SESSAO_HORAS * 60 * 60 * 1000
  };
  await setSessao(sessao);
  return sessao;
}

// Estende sessão para mais N minutos completos a partir de AGORA
async function estenderSessao(minutos) {
  const s = await getSessao();
  if (!s) return null;
  s.expira_em = Date.now() + minutos * 60 * 1000;
  await setSessao(s);
  return s;
}

function tempoRestante(sessao) {
  if (!sessao || !sessao.expira_em) return -1;
  return sessao.expira_em - Date.now();
}

window.Auth = {
  getSessao, setSessao, clearSessao, fazerLogin, estenderSessao, tempoRestante,
  SESSAO_HORAS
};
})();
