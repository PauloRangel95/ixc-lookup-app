// ixc-ozmap-criar — ESCRITA no OZmap (Fase 3): cria imóvel+cliente+drop, ou apaga (desfazer).
// Entrada criar:  { acao:'criar', login_id, client:{code,name}, box, coords:[lng,lat], drop_poles:[ids], auto_connect?, port? }
// Entrada apagar: { acao:'apagar', property_id }
// Credenciais ficam AQUI no servidor (n8n), NUNCA no PWA.
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

// Trava de segurança: nesta fase só cria para este login de teste. Troque/limpe quando validar.
const SOMENTE_LOGIN_TESTE = '9441';

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

try {
  const token = await ozToken.call(this);

  // ── APAGAR (desfazer) ──
  if (acao === 'apagar') {
    const pid = String(body.property_id || '').trim();
    if (!pid) return [{ json:{ ok:false, erro:'property_id é obrigatório' } }];
    const antes = await ozById.call(this,token,'properties',pid);
    if (!antes) return [{ json:{ ok:false, erro:'imóvel não encontrado (já apagado?)' } }];
    await ozReq.call(this,token,'DELETE',`properties/${pid}`);
    return [{ json:{ ok:true, acao:'apagar', apagado:pid } }];
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

  const payload = {
    kind: 'property',
    client: { code: String(client.code), name: client.name || String(client.code) },
    box, project, coords,
    auto_connect: body.auto_connect !== false,
    drop_poles
  };
  if (body.port != null && body.port !== '') payload.port = Number(body.port);

  let criado;
  try { criado = await ozReq.call(this,token,'POST','properties',payload); }
  catch(e) {
    let dbg='';
    try { dbg = JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0,1800); } catch(_) { dbg='(nao serializavel)'; }
    return [{ json:{ ok:false, erro:'OZmap [criar]: ' + errInfo(e), payload_enviado: payload, erro_debug: dbg } }];
  }

  const pid = criado && (criado.id || criado._id);
  const depois = pid ? await ozById.call(this,token,'properties',pid) : null;
  return [{ json:{ ok:true, acao:'criar', property_id:pid, caixa:(boxObj.name||null), project,
    conferido: !!depois, raw:criado } }];

} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap: ' + (e.message||String(e)) } }];
}
