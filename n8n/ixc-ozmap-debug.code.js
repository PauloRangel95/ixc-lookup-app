// ixc-ozmap-debug — LEITURA crua p/ inspeção.
// Entrada: { login_id }  OU  { box_id }  (p/ inspecionar o splitter/portas da caixa).
const OZ_BASE   = 'https://carajasnet.ozmap.com.br:9994';
const OZ_CLIENT = 'COLE_O_clientId_DO_CKS';
const OZ_SECRET = 'COLE_O_clientSecret_DO_CKS';

const BASE = String(OZ_BASE).replace(/\/+$/,'').replace(/\/api\/v2$/i,'');
const body = $input.first().json.body || $input.first().json;
const loginId = String(body.login_id || body.code || '').trim();
const boxId   = String(body.box_id || '').trim();
if (!loginId && !boxId) return [{ json:{ ok:false, erro:'informe login_id ou box_id' } }];

function errInfo(e){ const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode)||''; let d=''; try{const b=e.response&&e.response.body; if(b) d=typeof b==='string'?b:JSON.stringify(b);}catch(_){} return (c?'HTTP '+c+' ':'')+(e.message||'')+(d?' :: '+String(d).slice(0,400):''); }
let AUTHPFX='';
async function ozToken(){ const r=await this.helpers.httpRequest({method:'POST',url:`${BASE}/api/v2/auth/token`,headers:{'Content-Type':'application/json'},body:{clientId:OZ_CLIENT,clientSecret:OZ_SECRET},json:true}); if(!r||!r.accessToken) throw new Error('sem accessToken'); return r.accessToken; }
async function ozGet(token,pathq,bodyObj){ const self=this; const doReq=(pfx)=>self.helpers.httpRequest({method:'GET',url:`${BASE}/api/v2/${pathq}`,headers:{'Authorization':pfx+token,'Content-Type':'application/json'},body:bodyObj||undefined,json:true}); try{return await doReq(AUTHPFX);}catch(e){const c=e.httpCode||e.statusCode||(e.response&&e.response.statusCode); if(c===401&&AUTHPFX===''){AUTHPFX='Bearer ';return await doReq(AUTHPFX);} throw e;} }
async function ozList(token,rota,filtro,limit){ try{ let q=`page=1&limit=${limit||1}`; if(filtro) q+='&filter='+encodeURIComponent(JSON.stringify(filtro)); const r=await ozGet.call(this,token,`${rota}?${q}`,filtro?{filter:filtro}:undefined); return (r&&Array.isArray(r.rows))?r.rows:[]; }catch(e){ throw new Error('['+rota+'] '+errInfo(e)); } }
async function ozById(token,rota,id){ if(!id) return null; try{ return await ozGet.call(this,token,`${rota}/${id}`); }catch(e){ return null; } }

try {
  const token = await ozToken.call(this);

  // ── Inspeciona o SPLITTER de uma caixa (p/ entender porta livre/conectorizada) ──
  if (boxId) {
    const box = await ozById.call(this,token,'boxes',boxId);
    // tenta achar splitters da caixa por vários campos/rotas
    let splitters=[], spl_rota=null;
    for (const tent of [
      ['connectables',[{property:'parent',operator:'=',value:boxId}]],
      ['splitters',[{property:'parent',operator:'=',value:boxId}]],
      ['splitters',[{property:'box',operator:'=',value:boxId}]],
      ['connectables',[{property:'box',operator:'=',value:boxId}]],
    ]) {
      try { const r = await ozList.call(this,token,tent[0],tent[1],20); if (r && r.length) { splitters=r; spl_rota=tent[0]; break; } } catch(e){}
    }
    return [{ json:{ ok:true, box_id:boxId, box_nome:(box&&box.name)||null,
      box_cables:(box&&box.cables)||null, splitters, spl_rota } }];
  }

  // ── Inspeciona um cliente ──
  const rows = await ozList.call(this,token,'ftth-clients',[{property:'code',operator:'=',value:loginId}],1);
  const cli = rows[0];
  if (!cli) return [{ json:{ ok:true, encontrado:false, motivo:'cliente não achado pelo code '+loginId } }];
  const cliId = cli.id||cli._id;
  const imoveis = await ozList.call(this,token,'properties',[{property:'client',operator:'=',value:cliId}],1);
  const imv = imoveis[0] || null;
  const box = imv && imv.box ? await ozById.call(this,token,'boxes',imv.box) : null;
  return [{ json:{ ok:true, encontrado:true, login_id:loginId,
    RAW_ftth_client: cli, RAW_property: imv, RAW_box: box } }];
} catch(e) {
  return [{ json:{ ok:false, erro:'OZmap debug: '+(e.message||String(e)) } }];
}
