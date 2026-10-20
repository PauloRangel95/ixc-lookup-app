// ixc-ozmap-mapa — leitura (GET-only): CTOs e postes próximos de um ponto.
// Alimenta a tela de mapa onde o técnico desenha o drop (Fase 3).
// Entrada (webhook): { lat, lng, radius? }   (radius em metros, default 400)
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994'; // ORIGEM (com porta, SEM /api/v2)
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');

const body = $input.first().json.body || $input.first().json;
const lat = Number(body.lat), lng = Number(body.lng);
const radius = Number(body.radius) > 0 ? Number(body.radius) : 400;
if (!isFinite(lat) || !isFinite(lng)) return [{ json:{ ok:false, erro:'lat e lng são obrigatórios' } }];

function errInfo(e) {
  const code = e.httpCode || e.statusCode || (e.response && e.response.statusCode) || '';
  let detail = '';
  try { const b = e.response && e.response.body; if (b) detail = typeof b === 'string' ? b : JSON.stringify(b); } catch(_) {}
  if (!detail && e.description) detail = (typeof e.description === 'string') ? e.description : JSON.stringify(e.description);
  return (code ? 'HTTP ' + code + ' ' : '') + (e.message || '') + (detail ? ' :: ' + String(detail).slice(0,300) : '');
}

let AUTHPFX = '';
async function ozToken() {
  try {
    const r = await this.helpers.httpRequest({
      method:'POST', url:`${BASE}/api/v2/auth/token`,
      headers:{ 'Content-Type':'application/json' },
      body:{ clientId:OZ_CLIENT, clientSecret:OZ_SECRET }, json:true
    });
    if (!r || !r.accessToken) throw new Error('resposta sem accessToken');
    return r.accessToken;
  } catch(e) { throw new Error('[auth] ' + errInfo(e)); }
}
async function ozGet(token, pathq, bodyObj) {
  const self = this;
  const doReq = (pfx) => self.helpers.httpRequest({
    method:'GET', url:`${BASE}/api/v2/${pathq}`,
    headers:{ 'Authorization': pfx + token, 'Content-Type':'application/json' },
    body: bodyObj || undefined, json:true
  });
  try { return await doReq(AUTHPFX); }
  catch(e) {
    const code = e.httpCode || e.statusCode || (e.response && e.response.statusCode);
    if (code === 401 && AUTHPFX === '') { AUTHPFX = 'Bearer '; return await doReq(AUTHPFX); }
    throw e;
  }
}
async function ozList(token, rota, filtro, limit) {
  try {
    let q = `page=1&limit=${limit}`;
    if (filtro) q += '&filter=' + encodeURIComponent(JSON.stringify(filtro));
    const r = await ozGet.call(this, token, `${rota}?${q}`, filtro ? { filter: filtro } : undefined);
    return (r && Array.isArray(r.rows)) ? r.rows : [];
  } catch(e) { throw new Error('['+rota+'] ' + errInfo(e)); }
}
async function ozById(token, rota, id) {
  if (!id) return null;
  try { return await ozGet.call(this, token, `${rota}/${id}`); } catch(e) { return null; }
}

try {
  const token = await ozToken.call(this);
  const near = [{ property:'coords', operator:'near', value:{ lat, lng, radius } }];
  const [boxes, points] = await Promise.all([
    ozList.call(this, token, 'boxes',  near, 60),
    ozList.call(this, token, 'points', near, 300),
  ]);

  // Resolve o código do tipo de caixa (CTO/CD/CE) — poucos ids únicos
  const tipoIds = [...new Set(boxes.map(b => b.boxType).filter(Boolean))];
  const tipos = {};
  await Promise.all(tipoIds.map(async id => { const t = await ozById.call(this, token, 'box-types', id); if (t) tipos[id] = t.code || t.name || null; }));

  const coord = o => o ? (o.coords || (o.lng!=null && o.lat!=null ? [o.lng,o.lat] : null)) : null;

  return [{ json: {
    ok:true, center:[lng,lat], radius, auth_modo: AUTHPFX ? 'bearer' : 'cru',
    caixas: boxes.map(b => ({
      id: b.id||b._id, nome: b.name||null, tipo: tipos[b.boxType]||null,
      implantada: b.implanted===true, coords: coord(b)
    })).filter(c => c.coords),
    postes: points.map(p => ({ id: p.id||p._id, coords: coord(p) })).filter(p => p.coords),
    _counts: { caixas: boxes.length, postes: points.length }
  } }];
} catch(e) {
  return [{ json: { ok:false, erro: 'OZmap: ' + (e.message||String(e)) } }];
}
