import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..")));

// ---------------------------------------------------------------------------
// Supabase
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

// ---------------------------------------------------------------------------
// Auth — sessions em memória, cookie httpOnly
// ---------------------------------------------------------------------------
const SESSIONS    = new Map(); // token → expiresAt
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias

function createSession() {
  const token = randomBytes(32).toString("hex");
  SESSIONS.set(token, Date.now() + SESSION_TTL);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const exp = SESSIONS.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { SESSIONS.delete(token); return false; }
  return true;
}

function getSessionToken(req) {
  const header = req.headers.cookie || "";
  const match  = header.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

function setCookieHeader(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`;
}

function authMiddleware(req, res, next) {
  if (!validateSession(getSessionToken(req))) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}


// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  const { user, password } = req.body;
  if (!user || !password) {
    return res.status(400).json({ error: "Preencha usuário e senha" });
  }

  try {
    const { data, error: dbError } = await supabase
      .from("users")
      .select("password_hash")
      .eq("username", user)
      .maybeSingle();

    if (dbError) {
      console.error("❌ Erro ao buscar usuário no Supabase:", dbError);
      return res.status(500).json({ error: "Erro interno ao autenticar" });
    }

    // Resposta genérica para não vazar se o usuário existe ou não
    if (!data || !(await bcrypt.compare(password, data.password_hash))) {
      return res.status(401).json({ error: "Usuário ou senha incorretos" });
    }

    const token = createSession();
    res.setHeader("Set-Cookie", setCookieHeader(token));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/check", (req, res) => {
  if (!validateSession(getSessionToken(req))) {
    return res.status(401).json({ ok: false });
  }
  return res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) SESSIONS.delete(token);
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Supabase storage helpers
// ---------------------------------------------------------------------------
function anoMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function slugify(str) {
  return (str || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/, "")
    .slice(0, 80) || "arquivo";
}

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

async function saveInvitation(id, inv) {
  const { error } = await supabase.from("invitations").insert({
    id,
    tipo:       inv.tipo,
    tema:       inv.tema,
    nome:       inv.nome,
    subtitulo:  inv.subtitulo,
    mensagem:   inv.mensagem,
    data:       inv.data,
    hora:       inv.hora,
    local:      inv.local,
    whatsapp:   inv.whatsapp,
    maps:       inv.maps,
    presentes:  inv.presentes,
    criado_em:  inv.criadoEm,
    expires_at: inv.expiresAt || null,
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
    expiresAt: data.expires_at,
  };
}

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
// Multer — upload de PDF
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(Object.assign(new Error("Apenas PDF é permitido"), { status: 400 }));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// API routes — protegidas (criador)
// ---------------------------------------------------------------------------
app.post("/api/upload", authMiddleware, (req, res) => {
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

app.post("/api/qrcode", authMiddleware, async (req, res) => {
  const { tipo, urlDestino, nome, cor, imagemBase64 } = req.body;

  if (!tipo || !urlDestino || !imagemBase64) {
    return res.status(400).json({ error: "Campos obrigatórios: tipo, urlDestino, imagemBase64" });
  }

  try {
    const base64 = imagemBase64.replace(/^data:image\/png;base64,/, "");
    const imagemBuffer = Buffer.from(base64, "base64");
    const id = randomUUID();

    const imagemUrl = await saveQRCode({
      id, tipo, urlDestino,
      nome: nome || "qrcode",
      cor:  cor  || "#d81b60",
      imagemBuffer,
    });

    return res.json({ id, imagemUrl });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/convite", authMiddleware, async (req, res) => {
  const { nome, tipo, tema, subtitulo, mensagem, data, hora, local, whatsapp, maps, presentes } = req.body;

  if (!nome || !data) {
    return res.status(400).json({ error: "Campos obrigatórios: nome, data" });
  }

  try {
    const id = randomUUID();
    await saveInvitation(id, {
      id, tipo: tipo || "festa", tema: tema || "rosa", nome,
      subtitulo: subtitulo || "", mensagem: mensagem || "", data,
      hora: hora || "", local: local || "", whatsapp: whatsapp || "",
      maps: maps || "", presentes: Array.isArray(presentes) ? presentes : [],
      criadoEm: new Date().toISOString(),
    });

    return res.json({ id, url: `/convite.html?id=${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/hotspot", authMiddleware, async (req, res) => {
  const { pdfUrl, hotspots } = req.body;

  if (!pdfUrl) return res.status(400).json({ error: "Campo obrigatório: pdfUrl" });
  if (!Array.isArray(hotspots) || hotspots.length === 0) {
    return res.status(400).json({ error: "Adicione pelo menos um hotspot" });
  }

  try {
    const id = randomUUID();
    await saveHotspot(id, {
      id, pdfUrl,
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

// ---------------------------------------------------------------------------
// API routes — públicas (visitantes)
// ---------------------------------------------------------------------------
app.get("/api/convite/:id", async (req, res) => {
  try {
    const invitation = await readInvitation(req.params.id);
    if (!invitation) return res.status(404).json({ error: "Convite não encontrado" });
    if (invitation.expiresAt && new Date() > new Date(invitation.expiresAt)) {
      return res.status(410).json({ error: "Este convite expirou", expired: true });
    }
    return res.json(invitation);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/api/hotspot/:id", async (req, res) => {
  try {
    const doc = await readHotspot(req.params.id);
    if (!doc) return res.status(404).json({ error: "Documento não encontrado" });
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
app.listen(3000, () => {
  console.log("🚀 Papely rodando em http://localhost:3000");
});
