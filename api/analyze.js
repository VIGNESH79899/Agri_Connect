// api/analyze.js
import formidable from "formidable";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const ALLOWED_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

    const form = formidable({
      multiples: false,
      uploadDir: os.tmpdir(),
      keepExtensions: true,
      filter: (part) => {
        const ext = path.extname(part.originalFilename || "").toLowerCase();
        return part.mimetype?.startsWith("image/") && ALLOWED_UPLOAD_EXTS.has(ext);
      },
    });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    if (!files?.image) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const img = files.image;
    const imgPath = img.filepath || img.path;

    if (!fs.existsSync(imgPath)) {
      return res.status(400).json({ error: "Image missing on server" });
    }

    const ext = path.extname(imgPath).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
      fs.unlinkSync(imgPath);
      return res.status(400).json({ error: "Invalid file type" });
    }

    const fileBuffer = fs.readFileSync(imgPath);
    const base64 = fileBuffer.toString("base64");
    const mime = img.mimetype || "image/jpeg";

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY not found in environment variables.",
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    const geminiReqBody = {
      model: model,
      contents: [
        {
          parts: [
            { text: "You are an expert Indian agronomist. Analyze this crop image and give step-by-step diagnosis and recommended actions." },
            {
              inlineData: {
                data: base64,
                mimeType: mime,
              },
            },
          ],
        },
      ],
    };

    const gemResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + process.env.GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReqBody),
    });

    const data = await gemResp.json();
    
    let analysisText = "";

    if (data?.candidates?.[0]?.content?.parts) {
      analysisText = data.candidates[0].content.parts
        .map((p) => p.text || "")
        .join("\n");
    }

    if (!analysisText) analysisText = "Unable to extract analysis from Gemini response.";

    return res.status(200).json({ analysis: analysisText, raw: data });

  } catch (error) {
    console.error("🔥 Gemini analyze error:", error);
    return res.status(500).json({
      error: "Server error during analysis",
      details: error.message,
    });
  }
}