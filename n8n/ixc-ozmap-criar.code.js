// ixc-ozmap-criar — ESCRITA no OZmap (Fase 3): cria imóvel+cliente+drop, ou apaga (desfazer).
// Entrada criar:  { acao:'criar', login_id, client:{code,name}, box, coords:[lng,lat], drop_poles:[ids], auto_connect?, port? }
// Entrada apagar: { acao:'apagar', property_id }
// Credenciais ficam AQUI no servidor (n8n), NUNCA no PWA.
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

// Trava de segurança por login (vazio = liberado geral). Preencha com um login p/ restringir a teste.
const SOMENTE_LOGIN_TESTE = '';

// Supabase (mesma instância do PWA/CKS) — grava a pendência de porta pro O&M revisar/limpar a caixa
const SUPA_URL = 'https://carajasnet-supabase.bwadmr.easypanel.host';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');
const body = $input.first().json.body || $input.first().json;
const acao = String(body.acao || 'criar');

function errInfo(e) {
  const r = e.response || {};
  const code = e.httpCode || e.statusCode || r.statusCode || r.status || '';
  let detail = '';
  try {
    let b = (r.body !== undefined) ? r.body
          : (r.data !== undefined) ? r.data
          : (e.cause && e.cause.response && e.cause.response.data);
    if (b === undefined && e.context && e.context.data !== undefined) b = e.context.data;
    if (b !== undefined && b !== null) detail = (typeof b === 'string') ? b : JSON.stringify(b);
  } catch(_) {}
  if (!detail && e.description) detail = (typeof e.description === 'string') ? e.description : JSON.stringify(e.description);
  return (code ? 'HTTP ' + code + ' ' : '') + (e.message || '') + (detail ? ' :: ' + String(detail).slice(0,600) : '');
}
let AUTHPFX = '';
async function ozToken() {
  try {
    const r = await this.helpers.httpRequest({ method:'POST', url:`${BASE}/api/v2/auth/token`,
      headers:{ 'Content-Type':'application/json' }, body:{ clientId:OZ_CLIENT, clientSecret:OZ_SECRET }, json:true });
    if (!r || !r.accessToken) throw new Error('resposta sem accessToken');
    return r.accessToken;
  } catch(e) { throw new Error('[auth] ' + errInfo(e)); }
}
async function ozReq(token, method, rota, obj) {
  const self = this;
  const doReq = (pfx) => self.helpers.httpRequest({ method, url:`${BASE}/api/v2/${rota}`,
    headers:{ 'Authorization': pfx + token, 'Content-Type':'application/json' }, body: obj || undefined, json:true });
  try { return await doReq(AUTHPFX); }
  catch(e) { const code=e.httpCode||e.statusCode||(e.response&&e.response.statusCode); if (code===401 && AUTHPFX===''){ AUTHPFX='Bearer '; return await doReq(AUTHPFX); } throw e; }
}
async function ozById(token, rota, id) { if(!id) return null; try { return await ozReq.call(this,token,'GET',`${rota}/${id}`); } catch(e){ return null; } }
async function supaInsert(tabela, row) {
  try {
    await this.helpers.httpRequest({ method:'POST', url:`${SUPA_URL}/rest/v1/${tabela}`,
      headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: row, json:true });
    return true;
  } catch(e) { return false; }
}
async function supaPatch(tabela, filtro, patch) {
  try {
    await this.helpers.httpRequest({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${tabela}?${filtro}`,
      headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: patch, json:true });
    return true;
  } catch(e) { return false; }
}

try {
  const token = await ozToken.call(this);

  // ── APAGAR (desfazer) ──
  if (acao === 'apagar') {
    const pid = String(body.property_id || '').trim();
    if (!pid) return [{ json:{ ok:false, erro:'property_id é obrigatório' } }];
    const antes = await ozById.call(this,token,'properties',pid);
    if (antes) { await ozReq.call(this,token,'DELETE',`properties/${pid}`); }
    // cancela a pendência (se houver) pra não deixar linha órfã na fila do O&M
    await supaPatch.call(this, 'cks_pwa_ozmap_pendencias',
      `property_id=eq.${encodeURIComponent(pid)}&status=eq.pendente`,
      { status:'cancelada', resolvido_em:new Date().toISOString() });
    return [{ json:{ ok:true, acao:'apagar', apagado:pid, ja_apagado: !antes } }];
  }

  // ── CRIAR ──
  const loginId = String(body.login_id || (body.client && body.client.code) || '').trim();
  if (SOMENTE_LOGIN_TESTE && loginId !== SOMENTE_LOGIN_TESTE) {
    return [{ json:{ ok:false, erro:'criação liberada só para o login de teste '+SOMENTE_LOGIN_TESTE+' nesta fase' } }];
  }
  const box = String(body.box || '').trim();
  const client = body.client || null;
  const coords = body.coords;
  const drop_poles = Array.isArray(body.drop_poles) ? body.drop_poles : [];
  if (!box) return [{ json:{ ok:false, erro:'box (CTO) é obrigatório' } }];
  if (!client || !client.code) return [{ json:{ ok:false, erro:'client.code é obrigatório' } }];
  if (!Array.isArray(coords) || coords.length!==2) return [{ json:{ ok:false, erro:'coords [lng,lat] é obrigatório' } }];

  // project vem da própria CTO
  const boxObj = await ozById.call(this,token,'boxes',box);
  if (!boxObj) return [{ json:{ ok:false, erro:'CTO não encontrada no OZmap' } }];
  const project = (boxObj.project && (boxObj.project.id || boxObj.project)) || null;
  if (!project) return [{ json:{ ok:false, erro:'CTO sem project no OZmap' } }];

  // OBS: NÃO mandar 'kind' (o OZmap recusa). project vem da CTO.
  const base = {
    client: { code: String(client.code), name: client.name || String(client.code) },
    box, project, coords, drop_poles
  };
  if (body.port != null && body.port !== '') base.port = Number(body.port);
  // address/potencyRead NÃO vão na criação (o OZ pode recusar) → PATCH depois do create.

  // 1) tenta conectar automaticamente numa porta livre da CTO;
  // 2) QUALQUER falha ao conectar → cria SEM conectar (auto_connect:false funciona sempre).
  let criado, conectado = true, erro_autoconnect = null;
  try {
    criado = await ozReq.call(this,token,'POST','properties', Object.assign({}, base, { auto_connect:true }));
  } catch(e) {
    erro_autoconnect = errInfo(e);   // POR QUE o auto_connect falhou (ex.: sem porta livre vs outro erro)
    try {
      criado = await ozReq.call(this,token,'POST','properties', Object.assign({}, base, { auto_connect:false }));
      conectado = false;
    } catch(e2) {
      let dbg=''; try { dbg = JSON.stringify(e2, Object.getOwnPropertyNames(e2)).slice(0,1500); } catch(_){}
      return [{ json:{ ok:false, erro:'OZmap [criar]: ' + errInfo(e2), erro_autoconnect: errInfo(e), payload_enviado: base, erro_debug: dbg } }];
    }
  }

  const pid = criado && (criado.id || criado._id);

  // ── Enriquece o IMÓVEL (pós-create, tolerante a falha): endereço + potência lida ──
  const propPatch = {};
  if (body.endereco) propPatch.address = String(body.endereco);
  if (body.potencia != null && body.potencia !== '' && isFinite(Number(body.potencia))) propPatch.potencyRead = Number(body.potencia);
  let prop_atualizado = false, prop_erro = null;
  if (pid && Object.keys(propPatch).length) {
    try { await ozReq.call(this,token,'PATCH',`properties/${pid}`, propPatch); prop_atualizado = true; }
    catch(e) { prop_erro = errInfo(e); }
  }

  // ── Preenche o ftth-client: estado "Certificado" + dados da ONU ──
  // Descobre o id do ftth-client (o create já criou/vinculou pelo code).
  let cliId = criado && criado.client && (criado.client.id || criado.client._id || criado.client);
  if (!cliId && pid) { const imv = await ozById.call(this,token,'properties',pid); cliId = imv && imv.client && (imv.client.id || imv.client._id || imv.client); }
  const onuIn = body.onu || {};
  const patchCli = {};
  if (body.certificar !== false) { patchCli.implanted = true; patchCli.certified = true; } // estado → Certificado
  const onuObj = {};
  if (onuIn.pppoe)  onuObj.user_PPPoE    = String(onuIn.pppoe);
  if (onuIn.serial) onuObj.serial_number = String(onuIn.serial);
  if (onuIn.mac)    onuObj.mac_address   = String(onuIn.mac).replace(/[^0-9a-fA-F]/g,'').toUpperCase();
  if (Object.keys(onuObj).length) patchCli.onu = onuObj;
  let cli_atualizado = false, cli_erro = null;
  if (cliId && Object.keys(patchCli).length) {
    try { await ozReq.call(this,token,'PATCH',`ftth-clients/${cliId}`, patchCli); cli_atualizado = true; }
    catch(e) { cli_erro = errInfo(e); }
  }

  // Criou SEM porta (CTO cheia no sistema) → registra pendência pro O&M limpar e liberar a porta.
  let pendencia = false;
  if (!conectado && pid) {
    pendencia = await supaInsert.call(this, 'cks_pwa_ozmap_pendencias', {
      property_id: pid, login_id: loginId, cliente_nome: (client.name || null),
      box_id: box, box_nome: (boxObj.name || null), coords: coords,
      criado_por: (body.criado_por || null), status: 'pendente'
    });
  }
  return [{ json:{ ok:true, acao:'criar', property_id:pid, conectado, erro_autoconnect, pendencia, caixa:(boxObj.name||null), project, ftth_client:cliId||null, cli_atualizado, cli_erro, prop_atualizado, prop_erro, raw:criado } }];

} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap: ' + (e.message||String(e)) } }];
}
