import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" })); // base64 de QR code cabe folgado em 2mb
app.use(express.static(path.join(__dirname, "..")));

// ---------------------------------------------------------------------------
// Supabase — credenciais via variáveis de ambiente (.env ou k8s secret)
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Defina SUPABASE_URL e SUPABASE_SERVICE_KEY no .env ou no secret do k8s");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Helpers ────────────────────────────────────────────────────
function anoMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Remove acentos, caracteres especiais e espaços — mantém letras, números, -, _, .
function slugify(str) {
  return (str || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/, "")
    .slice(0, 80) || "arquivo";
}

// ---------------------------------------------------------------------------
// Camada de armazenamento — Supabase Storage + PostgreSQL
//
// Para trocar de provedor no futuro, altere apenas as funções abaixo.
// O restante do código não precisa mudar.
// ---------------------------------------------------------------------------

// PDFs → bucket "pdfs" (público)
// Nomenclatura: pdfs/YYYY-MM/timestamp-uuid-nome-original.pdf
async function saveFile(originalName, buffer, mimetype) {
  const safe = slugify(originalName || "documento.pdf");
  const storagePath = `pdfs/${anoMes()}/${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`;

  const { error } = await supabase.storage
    .from("pdfs")
    .upload(storagePath, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error(`Upload PDF: ${error.message}`);

  const { data } = supabase.storage.from("pdfs").getPublicUrl(storagePath);
  return data.publicUrl;
}

// Convites → tabela "invitations"
async function saveInvitation(id, inv) {
  const { error } = await supabase.from("invitations").insert({
    id,
    tipo:      inv.tipo,
    tema:      inv.tema,
    nome:      inv.nome,
    subtitulo: inv.subtitulo,
    mensagem:  inv.mensagem,
    data:      inv.data,
    hora:      inv.hora,
    local:     inv.local,
    whatsapp:  inv.whatsapp,
    maps:      inv.maps,
    presentes: inv.presentes,
    criado_em: inv.criadoEm,
  });
  if (error) throw new Error(`Salvar convite: ${error.message}`);
}

async function readInvitation(id) {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id:        data.id,
    tipo:      data.tipo,
    tema:      data.tema,
    nome:      data.nome,
    subtitulo: data.subtitulo,
    mensagem:  data.mensagem,
    data:      data.data,
    hora:      data.hora,
    local:     data.local,
    whatsapp:  data.whatsapp,
    maps:      data.maps,
    presentes: data.presentes,
    criadoEm:  data.criado_em,
  };
}

// Hotspots → tabela "hotspots"
async function saveHotspot(id, doc) {
  const { error } = await supabase.from("hotspots").insert({
    id,
    pdf_url:   doc.pdfUrl,
    hotspots:  doc.hotspots,
    criado_em: doc.criadoEm,
  });
  if (error) throw new Error(`Salvar hotspot: ${error.message}`);
}

async function readHotspot(id) {
  const { data, error } = await supabase
    .from("hotspots")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id:       data.id,
    pdfUrl:   data.pdf_url,
    hotspots: data.hotspots,
    criadoEm: data.criado_em,
  };
}

// QR Codes → bucket "qrcodes" (público) + tabela "qrcodes"
// Nomenclatura: qrcodes/YYYY-MM/timestamp-uuid-nome.png
async function saveQRCode({ id, tipo, urlDestino, nome, cor, imagemBuffer }) {
  const safe = slugify(nome || "qrcode");
  const storagePath = `qrcodes/${anoMes()}/${Date.now()}-${id.slice(0, 8)}-${safe}.png`;

  const { error: uploadError } = await supabase.storage
    .from("qrcodes")
    .upload(storagePath, imagemBuffer, { contentType: "image/png", upsert: false });

  if (uploadError) throw new Error(`Upload QR: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("qrcodes").getPublicUrl(storagePath);

  const { error: dbError } = await supabase.from("qrcodes").insert({
    id,
    tipo,
    url_destino: urlDestino,
    nome,
    cor,
    imagem_url: urlData.publicUrl,
  });

  if (dbError) throw new Error(`Salvar QR no banco: ${dbError.message}`);

  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(Object.assign(new Error("Apenas PDF é permitido"), { status: 400 }));
    }
    cb(null, true);
  },
});

// POST /upload — recebe PDF, sobe para o Supabase Storage e retorna URL pública
app.post("/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(err.status || 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });

    try {
      const url = await saveFile(
        req.file.originalname || "documento.pdf",
        req.file.buffer,
        req.file.mimetype
      );
      return res.json({ url });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
});

// POST /qrcode — salva PNG do QR Code no Storage e metadados no banco
app.post("/qrcode", async (req, res) => {
  const { tipo, urlDestino, nome, cor, imagemBase64 } = req.body;

  if (!tipo || !urlDestino || !imagemBase64) {
    return res.status(400).json({ error: "Campos obrigatórios: tipo, urlDestino, imagemBase64" });
  }

  try {
    const base64 = imagemBase64.replace(/^data:image\/png;base64,/, "");
    const imagemBuffer = Buffer.from(base64, "base64");
    const id = randomUUID();

    const imagemUrl = await saveQRCode({
      id,
      tipo,
      urlDestino,
      nome: nome || "qrcode",
      cor:  cor  || "#d81b60",
      imagemBuffer,
    });

    return res.json({ id, imagemUrl });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /convite — cria um convite e retorna id + url pública
app.post("/convite", async (req, res) => {
  const { nome, tipo, tema, subtitulo, mensagem, data, hora, local, whatsapp, maps, presentes } = req.body;

  if (!nome || !data) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, data" });
  }

  try {
    const id = randomUUID();
    await saveInvitation(id, {
      id,
      tipo:      tipo      || "festa",
      tema:      tema      || "rosa",
      nome,
      subtitulo: subtitulo || "",
      mensagem:  mensagem  || "",
      data,
      hora:      hora      || "",
      local:     local     || "",
      whatsapp:  whatsapp  || "",
      maps:      maps      || "",
      presentes: Array.isArray(presentes) ? presentes : [],
      criadoEm:  new Date().toISOString(),
    });

    return res.json({ id, url: `/convite.html?id=${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /convite/:id — retorna dados de um convite
app.get("/convite/:id", async (req, res) => {
  try {
    const invitation = await readInvitation(req.params.id);
    if (!invitation) return res.status(404).json({ error: "Convite não encontrado" });
    return res.json(invitation);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /hotspot — salva PDF + configuração de hotspots
app.post("/hotspot", async (req, res) => {
  const { pdfUrl, hotspots } = req.body;

  if (!pdfUrl) return res.status(400).json({ error: "Campo obrigatório: pdfUrl" });
  if (!Array.isArray(hotspots) || hotspots.length === 0) {
    return res.status(400).json({ error: "Adicione pelo menos um hotspot" });
  }

  try {
    const id = randomUUID();
    await saveHotspot(id, {
      id,
      pdfUrl,
      hotspots: hotspots.map(h => ({
        id:    h.id    || randomUUID(),
        type:  h.type  || "link",
        icon:  h.icon  || "🔗",
        label: h.label || "",
        color: h.color || "#d81b60",
        value: h.value || "",
        page:  h.page  || 1,
        x:     parseFloat(h.x) || 50,
        y:     parseFloat(h.y) || 50,
        w:     parseFloat(h.w) || 8,
        h:     parseFloat(h.h) || 8,
      })),
      criadoEm: new Date().toISOString(),
    });

    return res.json({ id, url: `/hotspot-view.html?id=${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /hotspot/:id — retorna dados do documento com hotspots
app.get("/hotspot/:id", async (req, res) => {
  try {
    const doc = await readHotspot(req.params.id);
    if (!doc) return res.status(404).json({ error: "Documento não encontrado" });
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => {
  console.log("🚀 Papely rodando em http://localhost:3000");
});
