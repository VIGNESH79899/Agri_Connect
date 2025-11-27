import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const { imageUrl } = req.body;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert Indian agronomist. Analyze crop images for diseases, pests, nutrient deficiencies, water stress and give recommendations."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this crop image and provide complete guidance."
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_tokens: 700
    });

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
}
