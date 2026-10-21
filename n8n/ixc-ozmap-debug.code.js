// ixc-ozmap-debug — LEITURA crua p/ inspeção (descobrir como o OZmap guarda OLT/Slot/PON).
// Entrada: { login_id }  (= code do ftth-client). Rode num cliente REAL que já tem a conexão preenchida.
// Devolve os objetos CRUS (ftth-client, property, box) + lista de OLTs do OZmap.
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');
const body = $input.first().json.body || $input.first().json;
const loginId = String(body.login_id || body.code || '').trim();
if (!loginId) return [{ json:{ ok:false, erro:'informe login_id (code do cliente)' } }];

function errInfo(e){ const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode)||''; let d=''; try{const b=e.response&&e.response.body; if(b) d=typeof b==='string'?b:JSON.stringify(b);}catch(_){} return (c?'HTTP '+c+' ':'')+(e.message||'')+(d?' :: '+String(d).slice(0,400):''); }
let AUTHPFX='';
async function ozToken(){ const r=await this.helpers.httpRequest({method:'POST',url:`${BASE}/api/v2/auth/token`,headers:{'Content-Type':'application/json'},body:{clientId:OZ_CLIENT,clientSecret:OZ_SECRET},json:true}); if(!r||!r.accessToken) throw new Error('sem accessToken'); return r.accessToken; }
async function ozGet(token,pathq,bodyObj){ const self=this; const doReq=(pfx)=>self.helpers.httpRequest({method:'GET',url:`${BASE}/api/v2/${pathq}`,headers:{'Authorization':pfx+token,'Content-Type':'application/json'},body:bodyObj||undefined,json:true}); try{return await doReq(AUTHPFX);}catch(e){const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode); if(c===401&&AUTHPFX===''){AUTHPFX='Bearer ';return await doReq(AUTHPFX);} throw e;} }
async function ozList(token,rota,filtro,limit){ try{ let q=`page=1&limit=${limit||1}`; if(filtro) q+='&filter='+encodeURIComponent(JSON.stringify(filtro)); const r=await ozGet.call(this,token,`${rota}?${q}`,filtro?{filter:filtro}:undefined); return (r&&Array.isArray(r.rows))?r.rows:[]; }catch(e){ throw new Error('['+rota+'] '+errInfo(e)); } }
async function ozById(token,rota,id){ if(!id) return null; try{ return await ozGet.call(this,token,`${rota}/${id}`); }catch(e){ return null; } }

try {
  const token = await ozToken.call(this);
  const rows = await ozList.call(this,token,'ftth-clients',[{property:'code',operator:'=',value:loginId}],1);
  const cli = rows[0];
  if (!cli) return [{ json:{ ok:true, encontrado:false, motivo:'cliente não achado pelo code '+loginId } }];
  const cliId = cli.id||cli._id;
  const imoveis = await ozList.call(this,token,'properties',[{property:'client',operator:'=',value:cliId}],1);
  const imv = imoveis[0] || null;
  const box = imv && imv.box ? await ozById.call(this,token,'boxes',imv.box) : null;
  // Tenta listar OLTs do OZmap (o nome do endpoint pode variar) — só pra ver o inventário.
  let olts=null, olts_rota=null;
  for (const rota of ['olts','equipments','ceos','pop-connections']) {
    try { const r = await ozList.call(this,token,rota,null,5); if (Array.isArray(r)) { olts=r; olts_rota=rota; break; } } catch(e){}
  }
  return [{ json:{
    ok:true, encontrado:true, login_id:loginId,
    RAW_ftth_client: cli,
    RAW_property: imv,
    RAW_box: box,
    OLTs_amostra: olts, OLTs_rota: olts_rota
  } }];
} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap debug: '+(e.message||String(e)) } }];
}
