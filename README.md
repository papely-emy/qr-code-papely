# 💗 Papely

Plataforma de ferramentas criativas para criação e compartilhamento de conteúdo interativo via link ou QR Code.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| **🔲 QR Code** | Gera QR Codes coloridos para links ou PDFs, download em PNG |
| **🎉 Convites Interativos** | Monta convites digitais com botões de WhatsApp, Maps e lista de presentes |
| **📌 PDF com Hotspots** | Sobe qualquer PDF e posiciona áreas clicáveis invisíveis sobre os ícones do documento |

---

## Como funciona

```
Usuário acessa → papely-qrcode.site
       │
       ├── /               → Página inicial (index.html)
       ├── /qrcode.html    → Ferramenta de QR Code
       ├── /convites.html  → Editor de convites
       ├── /hotspot.html   → Editor de PDF com hotspots
       │
       │  [quando salva algo]
       │
       ├── POST /upload    → Sobe PDF → guarda em memória → retorna URL
       ├── POST /convite   → Salva dados do convite → retorna link único
       └── POST /hotspot   → Salva PDF + posições → retorna link único
              │
              ▼
       Link compartilhável gerado automaticamente
       + QR Code para o link
```

---

## Arquitetura

O projeto tem dois serviços separados rodando em Kubernetes:

```
Internet → Cloudflare Tunnel
               │
               ▼
         Nginx Ingress (papely-qrcode.site)
               │
        ┌──────┴──────┐
        │             │
   /upload        tudo mais
   /files             │
   /convite/      ────▼────
   /hotspot/    Frontend (Nginx)
        │       HTML/CSS/JS estático
        ▼
   Backend (Node.js)
   Express + Multer
   Armazenamento em memória
```

### Frontend (`thsxn/papely-qrcode`)
- Nginx servindo arquivos estáticos
- HTML/CSS/JavaScript puro (sem framework)
- PDF.js para renderizar PDFs no browser
- QRCode.js para gerar QR Codes

### Backend (`thsxn/papely-backend`)
- Node.js + Express
- Multer para upload de PDFs (máx 10MB)
- Armazenamento **em memória** (Map) — dados perdidos ao reiniciar o pod
- Pronto para migrar para S3/GCS: basta trocar 6 funções em `server.js`

---

## Rodar localmente

```bash
# Instalar dependências do backend
cd backend
npm install

# Iniciar o servidor (porta 3000)
node server.js
```

Abrir no browser: `http://localhost:3000`

O backend já serve os arquivos HTML estáticos em desenvolvimento (`express.static`), então não precisa de servidor separado para o frontend.

---

## Deploy (produção)

O CI/CD é automático via **GitHub Actions**:

```
git push → main
    │
    ├── Build imagem Docker (frontend)    → thsxn/papely-qrcode:latest
    ├── Build imagem Docker (backend)     → thsxn/papely-backend:latest
    └── Push para Docker Hub
            │
            ▼
    Self-hosted runner (dentro do cluster)
            │
            └── kubectl apply → atualiza os pods no Kubernetes
```

### Arquivos de infraestrutura

```
k8s/base/
├── deployment.yaml          # Frontend (Nginx)
├── backend-deployment.yaml  # Backend (Node.js)
├── service.yaml             # Serviço interno do frontend
├── backend-service.yaml     # Serviço interno do backend
└── ingress.yaml             # Roteamento por path (/ vs /upload, /files, etc.)
```

### Secrets necessários no GitHub

| Secret | Valor |
|---|---|
| `DOCKERHUB_USERNAME` | Usuário do Docker Hub |
| `DOCKERHUB_TOKEN`    | Token de acesso do Docker Hub |

---

## Supabase — Setup

O backend usa Supabase para armazenar PDFs, QR Codes, convites e hotspots.

### 1. Criar as tabelas (SQL Editor no Supabase)

```sql
-- Convites
create table public.invitations (
  id         uuid primary key,
  tipo       text not null default 'festa',
  tema       text not null default 'rosa',
  nome       text not null,
  subtitulo  text default '',
  mensagem   text default '',
  data       text not null,
  hora       text default '',
  local      text default '',
  whatsapp   text default '',
  maps       text default '',
  presentes  jsonb default '[]',
  criado_em  timestamptz default now()
);

-- Hotspots (PDF interativo)
create table public.hotspots (
  id        uuid primary key,
  pdf_url   text not null,
  hotspots  jsonb not null default '[]',
  criado_em timestamptz default now()
);

-- QR Codes salvos
create table public.qrcodes (
  id          uuid primary key,
  tipo        text not null,        -- 'link' ou 'pdf'
  url_destino text not null,
  nome        text not null default 'qrcode',
  cor         text not null default '#d81b60',
  imagem_url  text,
  criado_em   timestamptz default now()
);
```

### 2. Criar os buckets de Storage

No painel do Supabase → **Storage** → New bucket:

| Bucket | Acesso |
|--------|--------|
| `pdfs` | Public |
| `qrcodes` | Public |

### 3. Variáveis de ambiente

Copie `backend/.env.example` para `backend/.env` e preencha:

```bash
cp backend/.env.example backend/.env
# edite o .env com seu SUPABASE_URL e SUPABASE_SERVICE_KEY
```

As credenciais ficam em: **Supabase Dashboard → Settings → API**

- `Project URL` → `SUPABASE_URL`
- `service_role` key → `SUPABASE_SERVICE_KEY` (⚠️ use apenas no backend, nunca no frontend)

### 4. Secret no Kubernetes (produção)

```bash
kubectl create secret generic papely-secrets \
  --from-literal=supabase-url="https://xxx.supabase.co" \
  --from-literal=supabase-service-key="eyJ..."
```

O deployment do backend já está configurado para ler essas variáveis do secret `papely-secrets`.

---

## Nomenclatura dos arquivos no Storage

```
pdfs/
  2024-06/
    1718000000000-a1b2c3d4-convite_festa.pdf
    1718000000001-e5f6g7h8-apresentacao.pdf

qrcodes/
  2024-06/
    1718000000000-a1b2c3d4-qrcode_evento.png
    1718000000001-e5f6g7h8-link_site.png
```

Formato: `{timestamp}-{uuid-curto}-{nome-slugificado}.{ext}`

---

## Stack

- **Frontend:** HTML · CSS · JavaScript (vanilla)
- **Backend:** Node.js · Express · Multer
- **PDF:** PDF.js (cdnjs)
- **QR Code:** QRCode.js (jsdelivr)
- **Infra:** Kubernetes · Kustomize · Cloudflare Tunnel
- **CI/CD:** GitHub Actions · Docker Hub
