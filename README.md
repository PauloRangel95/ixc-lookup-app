# IXC Lookup — PWA (versão mobile/web)

App web instalável que **reaproveita o código da extensão** (`popup.html`/`popup.js`/`auth.js`/`logger.js`) sem modificá-lo, via um shim de compatibilidade (`chrome-shim.js`). Roda em qualquer navegador (celular/desktop) e pode ser instalado na tela inicial.

> A extensão do Chrome continua **intocada**. Esta pasta é um build paralelo. Ao atualizar a extensão, copie de novo os arquivos `popup.js`, `auth.js`, `logger.js`, `relatorio.html`, `relatorio.js` para cá.

## Como funciona
- `chrome-shim.js` emula as APIs usadas: `chrome.storage.local` → `localStorage`; `chrome.tabs.create` → `window.open`; `chrome.runtime.getManifest().version`/`getURL`; `sidePanel`/`action` como no-op.
- **OLT Cloud:** o navegador bloqueia o acesso direto (CORS), então o shim **redireciona** as chamadas a `carajas.oltcloud.co` para um proxy n8n (`/webhook/ixc-olt-proxy`). Importe o workflow **OLT PROXY** (em `Downloads/teste n8n/OLT PROXY.json`) e ative-o; senão, o sinal OLT em tempo real fica indisponível (o resto funciona normal).
- `sw.js` (service worker) cacheia só a UI (app shell); chamadas de API vão sempre pela rede.

## Deploy — GitHub Pages (recomendado)
1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. O workflow `.github/workflows/pages.yml` publica esta pasta automaticamente a cada push na `main`.
3. URL final: `https://paulorangel95.github.io/lookup/`.

Alternativas: **Vercel/Netlify** (apontar o diretório `ixc-lookup-pwa/`) ou servir a pasta como site estático no **easypanel**. Os caminhos são relativos, então funciona em qualquer base.

## Instalar no celular
- **Android (Chrome):** abrir a URL → menu ⋮ → **Instalar app / Adicionar à tela inicial**.
- **iPhone (Safari):** abrir a URL → **Compartilhar** → **Adicionar à Tela de Início**.

## Atualizar a versão exibida
Ao subir a extensão de versão, ajuste também a constante em `chrome-shim.js` (`getManifest().version`).
