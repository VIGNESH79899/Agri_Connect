// api/analyze.js
import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // required because we use formidable
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    // Parse the uploaded file from form-data (field name: "image")
    const form = formidable({ multiples: false });

    const { files, fields } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        return resolve({ fields, files });
      });
    });

    if (!files || !files.image) {
      return res.status(400).json({ error: "Image not uploaded" });
    }

    // Read the file and convert to base64 data URL (support multiple formidable versions)
    const img = files.image;
    const imgPath = img.filepath || img.filePath || img.path;
    if (!imgPath || !fs.existsSync(imgPath)) {
      console.error("Uploaded image path not found:", imgPath, img);
      return res.status(400).json({ error: "Uploaded image file not found on server." });
    }

    const fileBuffer = fs.readFileSync(imgPath);
    const mime = img.mimetype || img.type || "image/jpeg";
    const base64 = fileBuffer.toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    // Ensure API key exists before creating the client
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set in environment variables.");
      return res.status(500).json({
        error:
          "Server misconfiguration: OPENAI_API_KEY is not set. Please configure your environment variables.",
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Use the Responses API which supports multimodal inputs (images + text)
    const promptInput = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "You are an expert Indian agronomist. Analyze this crop image and give clear, step-by-step guidance, diagnosis, and recommended actions." },
          { type: "input_image", image_url: dataUrl },
        ],
      },
    ];

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: promptInput,
    });

    // Robustly extract text from the response
    let analysisText = "";
    try {
      const output = response.output;
      if (typeof output === "string") {
        analysisText = output;
      } else if (Array.isArray(output)) {
        analysisText = output
          .map((out) => {
            if (!out) return "";
            if (typeof out === "string") return out;
            if (Array.isArray(out.content)) {
              return out.content
                .map((c) => c?.text || c?.type === "output_text" && c?.text || "")
                .filter(Boolean)
                .join(" ");
            }
            return "";
          })
          .filter(Boolean)
          .join("\n\n");
      } else if (response.output_text) {
        analysisText = response.output_text;
      }
    } catch (parseErr) {
      console.error("Error parsing OpenAI response:", parseErr, response);
    }

    if (!analysisText) {
      analysisText = "AI did not return any analysis for this image.";
    }

    return res.status(200).json({ analysis: analysisText, raw: response });
  } catch (error) {
    console.error("🔥 analyze API Error:", error);
    // Include message to aid debugging (do not include sensitive details)
    const message = error?.message || "Unknown server error";
    return res.status(500).json({
      error: "Server Error while analyzing image.",
      details: message,
    });
  }
}