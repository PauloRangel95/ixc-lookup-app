// ixc-ozmap-conectar — conecta um imóvel existente numa PORTA do splitter da CTO e resolve a pendência.
// Chamado pelo CKS quando o O&M confirma a porta liberada.
// Entrada: { property_id, port, resolvido_por? }
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';
const SUPA_URL  = 'https://carajasnet-supabase.bwadmr.easypanel.host';
const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');
const body = $input.first().json.body || $input.first().json;
const propertyId = String(body.property_id || '').trim();
const port = Number(body.port);
if (!propertyId) return [{ json:{ ok:false, erro:'property_id é obrigatório' } }];
if (!isFinite(port)) return [{ json:{ ok:false, erro:'port (número) é obrigatório' } }];

function errInfo(e) {
  const r = e.response || {};
  const code = e.httpCode || e.statusCode || r.statusCode || r.status || '';
  let detail = '';
  try {
    let b = (r.body !== undefined) ? r.body : (r.data !== undefined) ? r.data : (e.cause && e.cause.response && e.cause.response.data);
    if (b !== undefined && b !== null) detail = (typeof b === 'string') ? b : JSON.stringify(b);
  } catch(_) {}
  if (!detail && e.description) detail = (typeof e.description === 'string') ? e.description : JSON.stringify(e.description);
  return (code ? 'HTTP ' + code + ' ' : '') + (e.message || '') + (detail ? ' :: ' + String(detail).slice(0,500) : '');
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
  // Conecta o imóvel na porta (PATCH properties/:id). updateById não devolve corpo: sem throw = ok.
  try {
    await ozReq.call(this, token, 'PATCH', `properties/${propertyId}`, { port, auto_connect:true });
  } catch(e) {
    return [{ json:{ ok:false, erro:'OZmap [conectar]: ' + errInfo(e) } }];
  }
  // Resolve a pendência no Supabase
  const resolvido = await supaPatch.call(this, 'cks_pwa_ozmap_pendencias',
    `property_id=eq.${encodeURIComponent(propertyId)}&status=eq.pendente`,
    { status:'resolvida', porta_confirmada:port, resolvido_por:(body.resolvido_por||null), resolvido_em:new Date().toISOString() });
  return [{ json:{ ok:true, property_id:propertyId, port, pendencia_resolvida:resolvido } }];
} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap: ' + (e.message||String(e)) } }];
}
