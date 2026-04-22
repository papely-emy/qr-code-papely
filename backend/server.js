import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";

const app = express();
const upload = multer();

// 🔐 usa env (depois a gente melhora isso no k8s)
const supabase = createClient(
  "https://adkzekqmvrrvlvjvqmnf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFka3pla3FtdnJydmx2anZxbW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzYwODQsImV4cCI6MjA5MTQ1MjA4NH0.hjg7LZ2WA5sc09xXyjCMIm3VtWGZp6ryeeHRyo8WEDM"
);
app.use(cors());

// 📄 rota de upload
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Arquivo não enviado" });
    }

    // valida tipo (boa prática 🔥)
    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Apenas PDF permitido" });
    }

    const fileName = `pdf-${Date.now()}.pdf`;

    const { error } = await supabase.storage
      .from("papely-pdf")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error("Erro Supabase:", error);
      return res.status(500).json({ error: error.message });
    }

    const { data } = supabase.storage
      .from("papely-pdf")
      .getPublicUrl(fileName);

    return res.json({ url: data.publicUrl });

  } catch (err) {
    console.error("Erro interno:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

app.listen(3000, () => {
  console.log("🚀 Backend rodando na porta 3000");
});