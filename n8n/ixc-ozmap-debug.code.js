// ixc-ozmap-debug — LEITURA crua. Entradas: { login_id } | { box_id } | { fetch_rota, fetch_id } | { olts:true, q? }
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');
const body = $input.first().json.body || $input.first().json;
const loginId = String(body.login_id || body.code || '').trim();
const boxId   = String(body.box_id || '').trim();

function errInfo(e){ const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode)||''; let d=''; try{const b=e.response&&e.response.body; if(b) d=typeof b==='string'?b:JSON.stringify(b);}catch(_){} return (c?'HTTP '+c+' ':'')+(e.message||'')+(d?' :: '+String(d).slice(0,400):''); }
let AUTHPFX='';
async function ozToken(){ const r=await this.helpers.httpRequest({method:'POST',url:`${BASE}/api/v2/auth/token`,headers:{'Content-Type':'application/json'},body:{clientId:OZ_CLIENT,clientSecret:OZ_SECRET},json:true}); if(!r||!r.accessToken) throw new Error('sem accessToken'); return r.accessToken; }
async function ozGet(token,pathq,bodyObj){ const self=this; const doReq=(pfx)=>self.helpers.httpRequest({method:'GET',url:`${BASE}/api/v2/${pathq}`,headers:{'Authorization':pfx+token,'Content-Type':'application/json'},body:bodyObj||undefined,json:true}); try{return await doReq(AUTHPFX);}catch(e){const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode); if(c===401&&AUTHPFX===''){AUTHPFX='Bearer ';return await doReq(AUTHPFX);} throw e;} }
async function ozList(token,rota,filtro,limit){ try{ let q=`page=1&limit=${limit||1}`; if(filtro) q+='&filter='+encodeURIComponent(JSON.stringify(filtro)); const r=await ozGet.call(this,token,`${rota}?${q}`,filtro?{filter:filtro}:undefined); return (r&&Array.isArray(r.rows))?r.rows:[]; }catch(e){ throw new Error('['+rota+'] '+errInfo(e)); } }
async function ozById(token,rota,id){ if(!id) return null; try{ return await ozGet.call(this,token,`${rota}/${id}`); }catch(e){ return null; } }

try {
  const token = await ozToken.call(this);

  // fetch genérico por rota+id (p/ inspecionar olt/slot/pon/splitter)
  if (body.fetch_rota && body.fetch_id) {
    const obj = await ozById.call(this,token,String(body.fetch_rota),String(body.fetch_id));
    return [{ json:{ ok:true, rota:body.fetch_rota, id:body.fetch_id, obj } }];
  }

  // lista OLTs (filtro por nome em q)
  if (body.olts) {
    let rows = await ozList.call(this,token,'olts',null,500);
    const q = String(body.q||'').toLowerCase();
    if (q) rows = rows.filter(o => String(o.name||'').toLowerCase().includes(q));
    return [{ json:{ ok:true, total:rows.length, olts: rows.map(o=>({id:o.id,name:o.name,project:o.project,ip:o.ip})) } }];
  }

  // inspeciona splitter(s) de uma caixa
  if (boxId) {
    const box = await ozById.call(this,token,'boxes',boxId);
    let splitters=[];
    try { splitters = await ozList.call(this,token,'splitters',[{property:'parent',operator:'=',value:boxId}],20); } catch(e){}
    return [{ json:{ ok:true, box_id:boxId, box_nome:(box&&box.name)||null, splitters } }];
  }

  // inspeciona cliente
  if (loginId) {
    const rows = await ozList.call(this,token,'ftth-clients',[{property:'code',operator:'=',value:loginId}],1);
    const cli = rows[0];
    if (!cli) return [{ json:{ ok:true, encontrado:false } }];
    const imoveis = await ozList.call(this,token,'properties',[{property:'client',operator:'=',value:(cli.id||cli._id)}],1);
    const imv = imoveis[0] || null;
    return [{ json:{ ok:true, encontrado:true, RAW_ftth_client: cli, RAW_property: imv } }];
  }

  return [{ json:{ ok:false, erro:'informe login_id | box_id | fetch_rota+fetch_id | olts:true' } }];
} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap debug: '+(e.message||String(e)) } }];
}
