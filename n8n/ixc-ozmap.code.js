// ixc-ozmap — leitura (GET-only) da rede física no OZmap para a OS do PWA.
// Entrada (webhook): { login_id }   (= radusuarios.id do IXC == OZmap ftth-client.code)
// Credenciais ficam AQUI no servidor (n8n), NUNCA no PWA.
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994'; // ORIGEM (com porta, SEM /api/v2 no fim)
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

// Normaliza: remove barra final e um /api/v2 se o baseUrl vier com ele.
const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');

const body = $input.first().json.body || $input.first().json;
const loginId    = String(body.login_id || body.loginId || '').trim();
const loginPPPoE = String(body.login || body.pppoe || '').trim();
const onuMac     = String(body.onu_mac || '').replace(/[^0-9a-fA-F]/g,'').toUpperCase();
if (!loginId && !loginPPPoE && !onuMac) return [{ json: { ok:false, erro:'informe login_id, login (PPPoE) ou onu_mac' } }];

function errInfo(e) {
  const code = e.httpCode || e.statusCode || (e.response && e.response.statusCode) || '';
  let detail = '';
  try { const b = e.response && e.response.body; if (b) detail = typeof b === 'string' ? b : JSON.stringify(b); } catch(_) {}
  if (!detail && e.description) detail = (typeof e.description === 'string') ? e.description : JSON.stringify(e.description);
  return (code ? 'HTTP ' + code + ' ' : '') + (e.message || '') + (detail ? ' :: ' + String(detail).slice(0,300) : '');
}

// Descoberto em runtime: '' = token cru | 'Bearer ' = com Bearer
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

// GET genérico com fallback de Authorization (cru -> Bearer) no 401.
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

// Listagem com filtro no CORPO de um GET (igual ao SDK). page começa em 1. operador '=' .
async function ozList(token, rota, filtro, limit=1) {
  try {
    // Filtro vai na query string (?filter=JSON) E no corpo — cobre as duas formas do OZmap.
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

  // 1) cliente FTTH: tenta por code (= radusuarios.id), depois PPPoE, depois MAC da ONU.
  //    O "ok" de cada tentativa também é a GUARDA: confirma que o filtro realmente casou
  //    (se o OZmap ignorar o filtro e devolver o 1º registro, o ok() rejeita).
  const norm = s => String(s==null?'':s).trim();
  const tentativas = [];
  if (loginId)    tentativas.push({ via:'code',
    filtro:[{property:'code',operator:'=',value:loginId}],
    ok:(r)=> norm(r.code)===norm(loginId) });
  if (loginPPPoE) tentativas.push({ via:'pppoe',
    filtro:[{property:'onu.user_PPPoE',operator:'=',value:loginPPPoE}],
    ok:(r)=> norm(r.onu && r.onu.user_PPPoE).toLowerCase()===loginPPPoE.toLowerCase() });
  if (onuMac)     tentativas.push({ via:'onu_mac',
    filtro:[{property:'onu.mac_address',operator:'=',value:onuMac}],
    ok:(r)=> norm(r.onu && r.onu.mac_address).replace(/[^0-9a-fA-F]/g,'').toUpperCase()===onuMac });

  let cli = null, via = null;
  for (const t of tentativas) {
    let rows = [];
    try { rows = await ozList.call(this, token, 'ftth-clients', t.filtro, 1); } catch(e) { rows = []; }
    const r = rows[0];
    if (r && t.ok(r)) { cli = r; via = t.via; break; }
  }
  if (!cli) return [{ json:{ ok:true, encontrado:false, motivo:'não localizado no OZmap (tentou code/pppoe/mac)' } }];
  const cliId = cli.id || cli._id;

  // 2) imóvel do cliente
  const imoveis = await ozList.call(this, token, 'properties',
    [{ property:'client', operator:'=', value: cliId }], 1);
  const imv = imoveis[0];
  if (!imv) return [{ json:{ ok:true, encontrado:false, motivo:'imóvel não localizado',
    onu: cli.onu||null, status_cliente: cli.status } }];
  // Guarda: o imóvel tem que ser do cliente que achamos (senão o filtro de properties falhou).
  const imvClient = (imv.client && (imv.client.id || imv.client._id)) || imv.client;
  if (imvClient && String(imvClient) !== String(cliId)) {
    return [{ json:{ ok:true, encontrado:false, filtro_falhou:true,
      motivo:'imóvel não bateu com o cliente (filtro de properties não aplicou)' } }];
  }

  // 3) caixa + drop (+ tipo de caixa) em paralelo
  const boxId = imv.box || null, dropId = imv.drop || null;
  const [box, drop] = await Promise.all([
    ozById.call(this, token, 'boxes', boxId), ozById.call(this, token, 'cables', dropId)
  ]);
  const boxType = (box && box.boxType) ? await ozById.call(this, token, 'box-types', box.boxType) : null;

  const conn = (imv.connections||[]).find(c => (c.kind||'')==='Splitter') || null;

  let dropM = null;
  if (drop && drop.ground_length != null)
    dropM = Math.min(Math.round(Number(drop.ground_length)*1000), 500);

  const coord = o => o ? (o.coords || (o.lng!=null && o.lat!=null ? [o.lng,o.lat] : null)) : null;

  return [{ json: {
    ok:true, encontrado:true, login_id: loginId, via: via, auth_modo: AUTHPFX ? 'bearer' : 'cru',
    caixa: box ? {
      id: box.id||box._id, nome: box.name||null,
      tipo: boxType ? (boxType.code||boxType.name||null) : null,
      implantada: box.implanted===true, coords: coord(box)
    } : null,
    porta:       conn ? conn.port : null,
    fibra:       conn ? conn.fiber : null,
    splitter_id: conn ? conn.id : null,
    drop_m:      dropM,
    onu: cli.onu ? { pppoe: cli.onu.user_PPPoE||null, serial: cli.onu.serial_number||null, mac: cli.onu.mac_address||null } : null,
    status_cliente: cli.status,
    certificado:    cli.certified===true,
    endereco:       imv.address || null,
    coords_cliente: coord(imv),
    tracado_poles:  (drop && Array.isArray(drop.poles)) ? drop.poles : [],
    _ids: { ftth_client: cliId, property: imv.id||imv._id, box: boxId, drop: dropId }
  } }];
} catch(e) {
  return [{ json: { ok:false, erro: 'OZmap: ' + (e.message||String(e)) } }];
}
