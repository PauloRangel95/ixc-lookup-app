/* IXC Lookup PWA — logger via n8n (sem anon key no cliente).
 * Grava em ixc_logs através do webhook ixc-log-pwa (chave fica no servidor).
 */
(function () {
  const LOG_URL = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-log-pwa';

  function versaoExtensao() {
    try { return chrome?.runtime?.getManifest?.().version || null; } catch (e) { return null; }
  }

  async function registrarLog(sessao, acao, dados = {}) {
    if (!sessao) return;
    try {
      await fetch(LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario_id:    sessao.usuario_id,
          usuario_nome:  sessao.usuario_nome,
          usuario_login: sessao.usuario_login,
          token_proprio: sessao.token_proprio,
          acao:          acao,
          contrato_id:   dados.contrato_id || null,
          cliente_nome:  dados.cliente_nome || null,
          cliente_id:    dados.cliente_id   || null,
          detalhes:      dados.detalhes     || null,
          sucesso:       dados.sucesso !== undefined ? dados.sucesso : true,
          erro:          dados.erro         || null,
          extensao_versao: versaoExtensao()
        })
      });
    } catch (e) {
      console.warn('Erro ao registrar log (PWA):', e);
    }
  }

  window.Logger = { registrarLog };
})();
