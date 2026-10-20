# Fase 3 — Técnico mapear cliente no OZmap (escrita)

> Permitir que o técnico, quando um login estiver **"não mapeado no OZmap"**, **crie o imóvel + cliente + ligação na porta + drop** direto pelo PWA.
> ⚠️ **Escrita na rede real.** Só roda contra alvo de teste até liberação explícita.
> Status: rascunho · Atualizado: 2026-10-20

## Alvo de teste
- **Contrato:** 9777 · **Login (radusuarios.id = code OZmap):** 9441
- Estado atual conferido: **não existe no OZmap** (`encontrado:false`). Bom candidato para criar.

## Pré-requisitos (bloqueiam o início)
1. **Credencial de ESCRITA do OZmap** (clientId/secret com permissão de escrita; separada da leitura). Fica no n8n.
2. Confirmar que **9441/9777 é seguro** para criar/apagar no OZmap (teste).

## Fluxo na tela (PWA)
1. Login dá **"não mapeado"** → botão **"Mapear no OZmap"**.
2. **Escolher CTO:** lista as caixas próximas às coords do cliente (leitura `boxes` com filtro NEAR) ou busca por nome.
3. **Escolher porta:** mostra portas livres/ocupadas do splitter da CTO (leitura).
4. **Desenhar o drop (mapa):** o técnico traça o caminho real do cabo → vira `drop_poles` (NÃO é linha reta).
5. **Conferir dados** (código=9441, nome, coords, endereço — vindos do IXC).
6. **Confirmar** → cria no OZmap.

## Desenho do drop (decisão) — HÍBRIDO escolhido
O `drop_poles` é uma **sequência ordenada de postes** (ids de BasePoint no OZmap). Abordagem:
- **Mapa comum** (Leaflet + tiles de rua/satélite) com **CTO** e **cliente** marcados, e os **postes existentes** do OZmap plotados por perto (referência).
- O técnico **desenha livre** o caminho do cabo (toca os pontos na ordem CTO → cliente).
- **Ao salvar:** cada vértice desenhado é feito **snap no poste existente mais próximo** (dentro de uma tolerância, ex.: 25 m) → `drop_poles` = lista ordenada e sem repetição desses postes. **Liga pelos postes**, sem criar elementos.
- **Sem poste por perto:** o vértice é ignorado **ou** (opcional, com aviso) cria-se um `point` novo ali.
- Tolerância do snap e o "criar ponto quando não há poste" ficam configuráveis.

## Chamada de criação (OZmap)
`POST /api/v2/properties` (SDK `property.create`):
```jsonc
{
  "kind": "property",
  "client": { "code": "9441", "name": "<nome>" },
  "box": "<ctoBoxId>",
  "project": "<box.project>",
  "coords": [lng, lat],
  "address": "<endereço>",
  "auto_connect": true,
  "port": <porta>,
  "drop_poles": [ "<pointId>", ... ]   // CAMINHO DESENHADO pelo técnico (não linha reta)
}
```
- `project` e o splitter saem da **CTO escolhida** (box.project; splitter por `parent==boxId`).
- `coords`: o IXC traz em `complemento`/lat-long (formato "lat, lng" → converter para `[lng, lat]`).
- `connector`: opcional (tipo de conector); começar sem, com `auto_connect:true`.

## Leituras de apoio (seguras, já dá pra fazer com a credencial de leitura)
| Precisa | Rota OZmap | Observação |
|---|---|---|
| CTOs próximas | `boxes` filtro `coords NEAR {lat,lng,radius}` | lista caixas perto do cliente |
| Splitter da CTO | `splitters` filtro `parent == boxId` | portas e tipo |
| Portas ocupadas | `properties` na caixa | cruza `connections[].port` |
| Projeto da CTO | campo `box.project` | vai no create |

## Travas de segurança (obrigatórias)
- [ ] Rodar **só no alvo de teste** primeiro (9441/9777).
- [ ] **Ler antes** (confirmar que não existe) e **ler depois** (`findById`) — guardar o "antes".
- [ ] Confirmação explícita na tela + **log** (`acao = MAPEAR_OZMAP`, quem fez).
- [ ] Credencial de escrita com **permissão mínima**.
- [ ] Botão **desfazer** logo após criar (delete do que acabou de criar), enquanto validamos.
- [ ] Nada de escrita em massa; um imóvel por vez.

## Webhooks n8n previstos
- `ixc-ozmap-caixas` (leitura) — CTOs próximas + portas livres.
- `ixc-ozmap-criar` (**escrita**) — faz o `property.create`; usa a credencial de escrita; valida e devolve o id criado + estado pós-criação.

## Ordem
1. (agora, seguro) Leituras de apoio: listar CTOs e portas livres — testável já.
2. (com credencial de escrita) `ixc-ozmap-criar` + tela, testando **só** no 9441/9777.
3. Validado o teste → liberar para os técnicos, com as travas acima.
