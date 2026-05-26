// Página de relatório (aberta em aba) — lê o conteúdo do storage e imprime.
// Script externo (não inline) por causa da CSP da extensão.
(function () {
  const rel = document.getElementById('rel');
  chrome.storage.local.get(['ixc_relatorio'], d => {
    const r = (d && d.ixc_relatorio) || null;
    if (!r || !r.corpoHtml) {
      rel.innerHTML = '<p>Nenhum relatório para exibir. Gere novamente pela extensão.</p>';
      return;
    }
    document.title = r.titulo || 'Relatório — IXC Lookup';
    rel.innerHTML = r.corpoHtml;
    // limpa para não reabrir conteúdo antigo numa próxima navegação manual
    try { chrome.storage.local.remove('ixc_relatorio'); } catch (e) {}
    setTimeout(() => { try { window.print(); } catch (e) {} }, 350);
  });
  const btn = document.getElementById('btn-imprimir');
  if (btn) btn.addEventListener('click', () => window.print());
})();
