# Papely — Arquitetura e Documentação

## O que é o Papely

Papely é uma plataforma web com três ferramentas de criação e compartilhamento de conteúdo interativo. O usuário cria algo, recebe um link único e um QR Code, e compartilha com quem quiser.

---

## As três ferramentas

### 1. Gerador de QR Code (`/qrcode.html`)
O usuário cola uma URL ou sobe um PDF. O sistema gera um QR Code colorido. Pode baixar como PNG ou salvar no Supabase com nome e cor preservados.

**Fluxo:**
```
Usuário digita URL  →  Frontend gera QR no canvas (QRCode.js)
                    →  Clica "Baixar" → salva PNG localmente
                    →  Clica "Salvar ☁️" → POST /qrcode → Supabase Storage + tabela qrcodes

Usuário sobe PDF    →  POST /upload → Supabase Storage (bucket pdfs)
                    →  Retorna URL pública do PDF
                    →  Frontend gera QR apontando para /viewer.html?file=URL_DO_PDF
```

---

### 2. Convites Interativos (`/convites.html` → `/convite.html`)
O usuário preenche um formulário (nome, data, local, WhatsApp, Maps, lista de presentes). O sistema gera um convite visual com botões interativos, um link compartilhável e um QR Code.

**Fluxo:**
```
Usuário preenche formulário  →  Preview em tempo real (CSS themes)
                             →  Clica "Salvar" → POST /convite → tabela invitations
                             →  Recebe link: /convite.html?id=UUID

Visitante abre o link        →  GET /convite/:id → retorna dados do Supabase
                             →  HTML renderiza o convite visual
                             →  Botão WhatsApp → wa.me/numero
                             →  Botão Maps → maps.google.com/?q=local
                             →  Botão Presentes → abre lista em bottom sheet
```

**Temas disponíveis:** rosa, lilás, azul, dourado, verde (via CSS variables)

---

### 3. PDF com Hotspots (`/hotspot.html` → `/hotspot-view.html`)
O usuário sobe um PDF, posiciona áreas clicáveis invisíveis sobre os ícones do documento, configura a ação de cada botão (WhatsApp, Maps, link, lista de presentes) e gera um link compartilhável.

**Fluxo:**
```
Usuário sobe PDF             →  POST /upload → Supabase Storage (bucket pdfs)
                             →  PDF.js renderiza o PDF no canvas

Usuário posiciona hotspots   →  Drag para mover, arrastar canto ↘ para redimensionar
                             →  Posição salva em % do container (responsivo)
                             →  Configura ação: WhatsApp / Maps / Link / Presentes

Clica "Salvar"               →  POST /hotspot → tabela hotspots
                             →  Recebe link: /hotspot-view.html?id=UUID

Visitante abre o link        →  GET /hotspot/:id → retorna config do Supabase
                             →  PDF.js renderiza o PDF
                             →  Hotspots renderizados como áreas transparentes (opacity:0)
                             →  Cursor muda para pointer sobre os ícones do PDF
                             →  Clique dispara a ação configurada
```

---

## Diagrama de arquitetura

```
╔═══════════════════════════════════════════════════════════════════╗
║                          USUÁRIO (browser)                        ║
╚══════════════════════════════╤════════════════════════════════════╝
                               │ HTTPS
                               ▼
╔═══════════════════════════════════════════════════════════════════╗
║                      CLOUDFLARE TUNNEL                            ║
║            (expõe o cluster para a internet sem IP público)       ║
╚══════════════════════════════╤════════════════════════════════════╝
                               │
                               ▼
╔═══════════════════════════════════════════════════════════════════╗
║                  KUBERNETES CLUSTER (self-hosted)                  ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐  ║
║  │                    Nginx Ingress                             │  ║
║  │              papely-qrcode.site                             │  ║
║  │                                                             │  ║
║  │  /upload      ──────────────────────────┐                  │  ║
║  │  /files       ──────────────────────────┤                  │  ║
║  │  /convite/    ──────────────────────────┤                  │  ║
║  │  /hotspot/    ──────────────────────────┤                  │  ║
║  │  /qrcode      ──────────────────────────┤                  │  ║
║  │                                         ▼                  │  ║
║  │  /*  ────────────────────────►  ┌──────────────────┐       │  ║
║  │  (qualquer outra rota)          │ papely-backend   │       │  ║
║  │                       ┌────────►│  Node.js :3000   │       │  ║
║  │                       │         └────────┬─────────┘       │  ║
║  │              ┌────────┴───────┐          │                 │  ║
║  │              │ papely-frontend│          │                 │  ║
║  │              │  Nginx :80     │          │                 │  ║
║  │              │                │          │                 │  ║
║  │              │  index.html    │          │                 │  ║
║  │              │  qrcode.html   │          │                 │  ║
║  │              │  convites.html │          │                 │  ║
║  │              │  convite.html  │          │                 │  ║
║  │              │  hotspot.html  │          │                 │  ║
║  │              │  hotspot-view  │          │                 │  ║
║  │              │  viewer.html   │          │                 │  ║
║  │              └────────────────┘          │                 │  ║
║  └───────────────────────────────────────── │ ────────────────┘  ║
║                                             │                    ║
╚═════════════════════════════════════════════│════════════════════╝
                                              │ HTTPS API
                                              ▼
╔═══════════════════════════════════════════════════════════════════╗
║                         SUPABASE                                  ║
║                                                                   ║
║  PostgreSQL                    Storage                            ║
║  ┌───────────────────┐        ┌──────────────────────────────┐   ║
║  │  invitations      │        │  pdfs/                       │   ║
║  │  ├─ id (uuid)     │        │    2025-06/                  │   ║
║  │  ├─ nome          │        │      timestamp-uuid-arq.pdf  │   ║
║  │  ├─ data          │        │                              │   ║
║  │  ├─ whatsapp      │        │  qrcodes/                    │   ║
║  │  ├─ maps          │        │    2025-06/                  │   ║
║  │  └─ presentes[]   │        │      timestamp-uuid-nome.png │   ║
║  │                   │        └──────────────────────────────┘   ║
║  │  hotspots         │                                           ║
║  │  ├─ id (uuid)     │        URLs públicas retornadas           ║
║  │  ├─ pdf_url       │        diretamente para o frontend        ║
║  │  └─ hotspots[]    │        (PDF.js carrega de lá)             ║
║  │                   │                                           ║
║  │  qrcodes          │                                           ║
║  │  ├─ id (uuid)     │                                           ║
║  │  ├─ tipo          │                                           ║
║  │  ├─ url_destino   │                                           ║
║  │  └─ imagem_url    │                                           ║
║  └───────────────────┘                                           ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## CI/CD — o que acontece no git push

```
git push → main
    │
    ▼
GitHub Actions (2 workflows em paralelo)
    │
    ├── docker.yml
    │     ├── docker build → thsxn/papely-qrcode:latest   (frontend Nginx)
    │     ├── docker push
    │     ├── docker build → thsxn/papely-backend:latest  (backend Node.js)
    │     └── docker push
    │
    └── deploy.yml  (roda em self-hosted runner dentro do cluster)
          ├── kubectl kustomize k8s/overlays/dev
          ├── kubectl apply -k k8s/overlays/dev
          └── kubectl rollout restart deployment papely
```

Os dois pods pegam a nova imagem do Docker Hub e reiniciam automaticamente.

---

## Desenvolvimento local vs produção

| | Local | Produção |
|---|---|---|
| Servidor | `node server.js` na porta 3000 | Kubernetes (dois pods) |
| Frontend | Servido pelo Express (`express.static`) | Nginx separado |
| Acesso | `http://localhost:3000` | `https://papely-qrcode.site` |
| Credenciais | `backend/.env` | K8s Secret `papely-secrets` |
| Dados | Supabase (mesmo banco) | Supabase (mesmo banco) |

Em local, o Express serve tanto a API quanto os HTMLs. Em produção, o Ingress separa: HTMLs vão para o Nginx, chamadas de API vão para o Node.js.

---

## Por que ficou "complexo"

Há três camadas que se juntam:

**1. Dois serviços separados (frontend + backend)**
Em vez de um servidor servindo tudo, há um Nginx para HTML e um Node.js para API. Isso existe porque em produção é mais eficiente — Nginx é muito mais rápido para servir estáticos. Mas complica porque o Ingress precisa rotear as URLs certas para o lugar certo.

**2. Posições dos hotspots em porcentagem**
Os botões no editor precisam funcionar em qualquer tamanho de tela. A solução foi guardar a posição como `x: 50%` do container, não como pixels. Isso funciona, mas exige que o PDF seja sempre renderizado na mesma área proporcional.

**3. O hotspot é invisível no visualizador**
O PDF já tem ícones desenhados. O botão clicável precisa ficar em cima do ícone sem escondê-lo. Por isso o elemento HTML tem `opacity: 0` — existe e é clicável, mas não aparece. O cursor mudando para pointer é o único indicador para o usuário.

---

## Estrutura de arquivos

```
/
├── index.html              → Landing page (3 cards de ferramentas)
├── qrcode.html             → Ferramenta de QR Code
├── convites.html           → Editor de convites (formulário + preview)
├── convite.html            → Visualizador público do convite
├── hotspot.html            → Editor de hotspots (upload PDF + drag & drop)
├── hotspot-view.html       → Visualizador público com hotspots invisíveis
├── viewer.html             → Visualizador simples de PDF (via Google Docs no mobile)
│
├── backend/
│   ├── server.js           → API Express + integração Supabase
│   ├── package.json        → Deps: express, multer, cors, supabase-js, dotenv
│   ├── .env                → Credenciais locais (ignorado pelo git)
│   └── .env.example        → Template de variáveis (commitado)
│
├── k8s/
│   └── base/
│       ├── deployment.yaml           → Pod do frontend (Nginx)
│       ├── backend-deployment.yaml   → Pod do backend (Node.js) + env vars do secret
│       ├── service.yaml              → Serviço interno do frontend
│       ├── backend-service.yaml      → Serviço interno do backend
│       └── ingress.yaml              → Roteamento de URLs por path
│
└── .github/workflows/
    ├── docker.yml          → Build e push das imagens Docker
    └── deploy.yml          → kubectl apply no cluster (self-hosted runner)
```

---

## Permanência dos dados

| Dado | Onde fica | Persiste reinício? | Expira? |
|---|---|---|---|
| Convite | Supabase PostgreSQL | ✅ Sim | Não (manual) |
| Hotspot config | Supabase PostgreSQL | ✅ Sim | Não (manual) |
| PDF enviado | Supabase Storage | ✅ Sim | Não (manual) |
| QR Code salvo | Supabase Storage + PostgreSQL | ✅ Sim | Não (manual) |
| QR Code gerado mas não salvo | Só no canvas do browser | ❌ Não | Fecha a aba |

O link `papely-qrcode.site/hotspot-view.html?id=UUID` é permanente enquanto o projeto Supabase existir.
