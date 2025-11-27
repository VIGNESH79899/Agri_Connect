import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "Image URL is required" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert Indian agronomist. Analyze crop images for diseases, pests, nutrient deficiencies, water stress, and give clear, actionable instructions."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this crop image and give step-by-step guidance."
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    });

    return res.status(200).json(completion);
  } catch (err) {
    console.error("🔥 analyze API Error:", err);
    return res.status(500).json({ error: err.message });
  }
}