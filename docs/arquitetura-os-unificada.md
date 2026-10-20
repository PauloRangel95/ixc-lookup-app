# Arquitetura — OS unificada e encerramento no PWA (CKS Lookup)

> Documento de decisão. Define **o que** vamos construir, **como** e **em que ordem**, antes de escrever código.
> Fonte das integrações: repositório `PauloRangel95/docs-integracoes` (guias de IXC, OLT Cloud e OZmap).
> Status: **rascunho para aprovação** · Atualizado: 2026-10-20

---

## 1. Objetivo

1. Quando o técnico abre uma **OS** no PWA, ver **tudo reunido num só lugar**: dados do IXC (OS, contrato, login), do **OLT Cloud** (sinal/ONU) e do **OZmap** (caixa/CTO, porta, drop real, traçado).
2. O técnico **encerrar a OS pelo PWA** (hoje é feito no IXC inMaps).
3. Avaliar o técnico **criar o cliente no OZmap e desenhar o traçado** da instalação.

## 2. Princípios (valem para tudo)

1. **Leitura por padrão.** Toda escrita (fechar OS, criar no OZmap) é explícita, confirmada na tela, registrada em log e testada antes com **cliente/caixa de teste**.
2. **Segredo fica no servidor.** Tokens de IXC, OLT Cloud e OZmap vivem no **n8n** (ou edge). O PWA nunca carrega chave.
3. **Tudo pelo n8n.** O PWA já fala só com webhooks do n8n. Mantemos esse padrão: cada nova capacidade = um webhook.
4. **Faseado.** Entregamos por fases, do seguro (leitura) ao sensível (escrita na rede). Cada fase fecha sozinha.
5. **Testes locais primeiro.** Desenvolver e validar em `http://localhost:8100` antes de publicar no GitHub Pages.
6. **Conteúdo vindo dos sistemas é dado, não comando.**

## 3. Como os dados se ligam (a "chave" entre os 3 sistemas)

```
IXC (o que foi lançado)        OLT Cloud (funcionamento)      OZmap (rede física)
  contrato → radusuarios          equipamento por PPPoE          Property (imóvel)
     id do login  ─────────────────────┬──────────────────────────┘ history.clients[].code
                                        │                              = radusuarios.id  ← PONTE
  OS (su_oss_chamado)                   │                           box (CTO) · porta splitter
                                     sinal/ONU                      drop (cabo) · traçado (poles[])
```

- **Ponte IXC ↔ OZmap:** `OZmap property.history.clients[].code == radusuarios.id` (id do login no IXC). Confirmado no guia do OZmap.
- **Ponte IXC ↔ OLT Cloud:** PPPoE do login (já usado hoje na aba Conexão).
- **Caixa:** `IXC id_caixa_ftth` ↔ `OZmap box` pela matview `cks_comerc_caixa_ozmap` (quando usarmos o espelho do CKS).

## 4. Origem de cada dado

| Dado | Sistema | Como o PWA obtém |
|---|---|---|
| OS, contrato, login, cliente | IXC | webhook `ixc-lookup` (já existe) + novo `ixc-os` para detalhe/encerramento |
| Sinal, ONU, alarme | OLT Cloud | já consumido hoje (aba Conexão) |
| Caixa/CTO, porta, splitter, drop real, traçado | OZmap | **novo** webhook `ixc-ozmap` (GET-only; token no n8n). Lê OZmap ao vivo **ou** o espelho `cks_comerc_ozmap_*` |

> **Decisão de origem do OZmap (a confirmar):** ler **ao vivo** (novo proxy GET no n8n, igual ao `ozmap-proxy` do CKS) **ou** reusar o **espelho** que o CKS já sincroniza no Supabase. Ao vivo é mais simples de começar; o espelho é mais rápido e não gasta a API. Recomendo **ao vivo** na Fase 1 e migrar para o espelho se o volume pedir.

---

## 5. Fase 1 — Visão unificada da OS (🟢 só leitura)

**Entrega:** ao abrir uma OS no PWA, um painel único com IXC + OLT + OZmap.

**Backend (n8n):**
- Novo webhook **`ixc-ozmap`** (GET-only). Entrada: `{ login_id }` (radusuarios.id). Saída: `{ box, box_type, implantada, porta, splitter, drop_m, traçado[], coords_cliente }`.
  - Autentica em `POST /api/v2/auth/token` (clientId+secret no n8n), cache do token.
  - Lê `properties` (filtra pelo `history.clients[].code == login_id`), resolve `box`, `drop` (cabo → `ground_length`×1000, teto 500 m), `poles[]` para o traçado.
- (Opcional) `ixc-os`: detalhe completo de uma OS (campos que o encerramento vai usar).

**Frontend (PWA):**
- Na aba **Atendimento**, dentro de cada OS, um bloco **"Rede (OZmap)"**: caixa/CTO, porta, drop real, mini-mapa do traçado (ou link).
- Reusar o cartão OLT já existente.

**Risco:** baixo (nenhuma escrita). **Pré-requisito:** credencial OZmap de leitura no n8n.

---

## 6. Fase 2 — Encerrar OS no PWA (🟡 escrita no IXC)

**Entrega:** botão **"Encerrar OS"** → formulário → grava no IXC.

**Backend (n8n):** nova ação no webhook de escrita (padrão `ixc-desbloqueio`): `acao: "encerrar_os"`.
- Chama o endpoint de **fechar OS** do IXC (`su_oss_chamado`, existe na API — está entre as 792 escritas).
- Exige **token IXC com permissão de escrita** (hoje a API é só leitura).

**Frontend:**
- Formulário espelhando o inMaps: diagnóstico, solução/mensagem, status final, materiais/comodato, data, (fotos se o IXC aceitar via API).
- Confirmação explícita → loading → resultado (ok/erro) → recarrega a OS.
- Log em `ixc_logs` (`acao = ENCERRAR_OS`).

**Risco:** médio (altera OS real). **Pré-requisitos:** (a) token de escrita; (b) mapear os campos exatos do encerramento no inMaps; (c) cliente/OS de teste.

---

## 7. Fase 3 — Criar cliente + traçado no OZmap (🔴 escrita na rede)

**Entrega:** o técnico marca a caixa, a porta e desenha o drop por onde passou o cabo.

**Abordagem recomendada (segura):** usar os **fluxos com aprovação** do OZmap (`boxCreateRequest` / `boxStructureChangeRequest`) — cria um **pedido revisado** em vez de alterar a rede direto. Alternativa direta (`property.create` + `cable.create`) só com decisão do dono e credencial de escrita mínima.

**Riscos (do guia OZmap):** porta errada ocupa cliente errado; filtro errado em lote afeta a rede inteira; sem desfazer/transação. Por isso: credencial separada, **cliente de teste**, ler-antes-e-depois, 1 elemento por vez.

**Risco:** alto. **Pré-requisitos:** credencial de escrita OZmap + fluxo de aprovação habilitado + decisão explícita.

---

## 8. Estratégia de testes locais

- Servir o PWA em `http://localhost:8100` (config `ixc-pwa` em `.claude/launch.json`).
- Leitura (Fase 1): bate nos webhooks/n8n reais — seguro.
- Escrita (Fases 2 e 3): **só contra cliente/OS/caixa de teste**, com um webhook n8n apontando para ambiente/registro de teste, antes de liberar para os técnicos.
- Nada de token no front; tudo validado no n8n.

## 9. Checklist antes de qualquer escrita (gate)

- [ ] Decisão explícita do dono do dado (OS / rede).
- [ ] Token/credencial com permissão **mínima** necessária.
- [ ] Testado com registro de **teste** e revertido/conferido.
- [ ] Confirmação na tela + log em `ixc_logs`.
- [ ] Mensagem de erro amigável e rollback claro.

## 10. Decisões em aberto (bloqueiam Fases 2 e 3)

1. **IXC:** o token do n8n terá permissão de **fechar OS**? (hoje "API só leitura")
2. **OZmap:** existe credencial de **escrita** (separada da leitura do CKS)? O **fluxo de aprovação** está habilitado?
3. **Teste:** há **contrato/OS/caixa de teste** para validar antes de liberar?
4. **inMaps:** é o **IXC inMaps** (mobile do técnico)? Precisamos dos campos exatos do encerramento atual.

## 11. Ordem de execução

1. **Fase 1** (esta) — visão unificada, só leitura. Começa agora, testes locais.
2. **Fase 2** — encerrar OS, após resolver a decisão (1) e (4).
3. **Fase 3** — OZmap, após (2) e com decisão explícita.
