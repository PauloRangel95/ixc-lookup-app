# Handoff CKS ← PWA — Fila de pendências de porta no OZmap

> Integração **sem merge de código**: PWA e CKS se falam por **uma tabela no Supabase** (mesma instância: `carajasnet-supabase.bwadmr.easypanel.host`).
> Este doc é o contrato pra o time do CKS (BI digital) construir a **tela do O&M**.

## Visão geral
```
PWA (técnico cria no OZmap, CTO sem porta livre)
  → cria imóvel+cliente+drop SEM porta  (webhook ixc-ozmap-criar)
  → grava 1 linha em  cks_pwa_ozmap_pendencias  (status='pendente')
                          │
CKS / BI digital (O&M)  ◄─┘  lê a fila
  → O&M revisa a caixa no OZmap, limpa/libera a porta
  → confirma a porta na tela  → chama  ixc-ozmap-conectar
       → conecta o imóvel na porta (OZmap) + marca pendência 'resolvida'
```

## Tabela (contrato) — `cks_pwa_ozmap_pendencias`
SQL em [`../sql/cks_pwa_ozmap_pendencias.sql`](../sql/cks_pwa_ozmap_pendencias.sql). Campos:

| Campo | Tipo | Significado |
|---|---|---|
| `id` | bigint | PK |
| `property_id` | text | id do imóvel no OZmap |
| `login_id` | text | radusuarios.id (= code do cliente no OZmap) |
| `cliente_nome` | text | nome do cliente |
| `box_id` / `box_nome` | text | CTO (id e nome, ex.: CTO82) |
| `coords` | jsonb | `[lng, lat]` do cliente |
| `criado_por` | text | técnico que criou |
| `criado_em` | timestamptz | quando |
| `status` | text | `pendente` / `resolvida` / `cancelada` |
| `porta_confirmada` | int | porta que o O&M liberou |
| `resolvido_por` / `resolvido_em` | text / ts | O&M que resolveu |

## O que o CKS constrói (tela do O&M)
1. **Lista** as pendências `status = 'pendente'` (ordenar por `criado_em desc`). O CKS já tem acesso ao Supabase.
2. Para cada item: mostra cliente, CTO (`box_nome`), coords (link mapa), técnico, data. Pode cruzar com o espelho do OZmap (`cks_comerc_ozmap_*`) pra mostrar ocupação atual da caixa.
3. **Ação "Confirmar porta":** o O&M digita/escolhe a `porta` liberada e confirma.
   - O CKS chama o webhook **`ixc-ozmap-conectar`** (abaixo). Ele conecta no OZmap e marca a pendência como `resolvida`.
   - (Alternativa: o CKS pode fazer o UPDATE do status direto no Supabase, mas a **conexão no OZmap** tem que passar pelo webhook, que tem as credenciais.)
4. (Opcional) Ação **"Cancelar"** → `status='cancelada'` (UPDATE direto no Supabase).

## Webhook `ixc-ozmap-conectar` (já pronto no n8n)
- **URL:** `POST https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-ozmap-conectar`
- **Body:** `{ "property_id": "<id>", "port": <nº da porta>, "resolvido_por": "<O&M>" }`
- **Faz:** `PATCH /api/v2/properties/:id { port, auto_connect:true }` no OZmap + `UPDATE cks_pwa_ozmap_pendencias ... status='resolvida', porta_confirmada=port`.
- **Resposta:** `{ ok:true, property_id, port, pendencia_resolvida }` ou `{ ok:false, erro }`.
- Código: [`../n8n/ixc-ozmap-conectar.code.js`](../n8n/ixc-ozmap-conectar.code.js) (importar + preencher clientId/secret + ativar).
- ⚠️ A conexão por `PATCH ... port` ainda **não foi testada** numa caixa com porta livre — validar no primeiro uso real.

## Lado PWA (já feito)
- `ixc-ozmap-criar`: ao criar "sem porta" (`conectado:false`), insere a pendência em `cks_pwa_ozmap_pendencias`.
- Mensagem ao técnico: *"Criado · CTO sem porta livre → enviado pro O&M revisar/liberar a porta"*.

## Convenção de nomes
- Tabelas do CKS: prefixo `cks_…`; do PWA: `pwa_…` (quando aplicável).
- Tabela **compartilhada**: prefixo **`cks_pwa_…`** (os dois projetos).
