import { NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

export const maxDuration = 30;

// Completely disable all safety filters (100% unfiltered)
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

async function resolveModelCandidates(apiKey) {
  const preferredPriority = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-002",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-8b",
    "gemini-2.5-pro",
    "gemini-2.0-pro-exp-02-05",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
  ];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const rawModels = data.models || [];

      // Strictly filter models capable of multimodal vision / image input
      const visionModels = rawModels
        .filter((m) => {
          const methods = m.supportedGenerationMethods || [];
          if (!methods.includes("generateContent")) return false;

          const name = (m.name || "").toLowerCase();
          // Exclude text-to-speech, audio, embedding, and other non-image models
          if (
            name.includes("-tts") ||
            name.includes("tts") ||
            name.includes("audio") ||
            name.includes("embedding") ||
            name.includes("aqa") ||
            name.includes("imagen") ||
            name.includes("learnlm")
          ) {
            return false;
          }

          // If inputModalities is returned, ensure it explicitly includes 'image'
          if (Array.isArray(m.inputModalities) && m.inputModalities.length > 0) {
            const lowerMods = m.inputModalities.map((x) => String(x).toLowerCase());
            if (!lowerMods.includes("image")) return false;
          }

          return true;
        })
        .map((m) => m.name.replace("models/", ""));

      // Match preferred vision models first, then any other valid vision models
      const matched = preferredPriority.filter((p) => visionModels.includes(p));
      const remainingVision = visionModels.filter((v) => !matched.includes(v));
      const finalCandidates = [...matched, ...remainingVision];

      if (finalCandidates.length > 0) {
        console.log("Filtered vision candidate models:", finalCandidates);
        return finalCandidates;
      }
    }
  } catch (err) {
    console.warn("Dynamic model lookup failed, using defaults:", err);
  }

  return preferredPriority;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { image, apiKey: clientApiKey } = body;

    const apiKey = (clientApiKey || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Gemini API Key প্রয়োজন। অনুগ্রহ করে আপনার ফ্রি Google AI Studio API Key প্রদান করুন।",
        },
        { status: 400 }
      );
    }

    if (!image) {
      return NextResponse.json(
        { success: false, error: "কোনো ইমেজ পাওয়া যায়নি।" },
        { status: 400 }
      );
    }

    // Extract base64 data and mime type
    let mimeType = "image/jpeg";
    let base64Data = image;

    if (image.includes("data:") && image.includes(";base64,")) {
      const parts = image.split(";base64,");
      mimeType = parts[0].replace("data:", "");
      base64Data = parts[1];
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const candidateModels = await resolveModelCandidates(apiKey);

    const systemInstruction = `You are an expert Document, Receipt, Form, and UI layout-to-pixel-perfect HTML/CSS compiler.
Your job is purely technical OCR and layout reconstruction:
1. Extract EVERY single text item visible in the image (regardless of language - Bengali, English, Arabic, numerals).
2. For each text item, assign a unique numeric ID string ("0", "1", ...), the exact visible text, approximate bounding box [x, y, width, height] in pixels, font_size, and color.
3. Determine canvas width, canvas height, dominant background color, and color palette.
4. Construct a complete, standalone, pixel-perfect HTML/CSS replica. Each text item in the HTML MUST have id="el-{id}" or class="figma-element" matching the exact spatial coordinates (top, left, width, font-size, color, font-weight).
5. Output ONLY a valid JSON object matching this schema:
{
  "texts": [
    { "id": "0", "text": "...", "box": [x, y, w, h], "font_size": 14, "color": "#000000" }
  ],
  "canvas": { "width": 1000, "height": 1400 },
  "colors": { "dominant": "#ffffff", "palette": ["#000000", "#ffffff"] },
  "html": "<!DOCTYPE html><html>...</html>"
}`;

    const prompt = "Analyze this image and generate the exact pixel-perfect editable HTML/CSS replica and all text coordinates in JSON format. Do not skip or summarize any text.";

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    };

    let result = null;
    let lastError = null;

    for (const modelName of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          safetySettings,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
          systemInstruction,
        });

        result = await model.generateContent([prompt, imagePart]);
        if (result && result.response) {
          console.log(`Successfully generated content using model: ${modelName}`);
          break;
        }
      } catch (err) {
        console.warn(`Model ${modelName} failed:`, err.message);
        lastError = err;
        // Seamlessly try next candidate model
        continue;
      }
    }

    if (!result) {
      throw lastError || new Error("Failed to generate content with available Gemini models.");
    }

    const responseText = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error("AI response was not valid JSON: " + responseText.slice(0, 200));
      }
    }

    return NextResponse.json({
      success: true,
      status: "success",
      texts: parsed.texts || [],
      html: parsed.html || "",
      generatedHTML: parsed.html || "",
      canvas: parsed.canvas || { width: 1000, height: 1400 },
      width: parsed.canvas?.width || 1000,
      height: parsed.canvas?.height || 1400,
      dominantColor: parsed.colors?.dominant || "#ffffff",
      palette: parsed.colors?.palette || [],
      colors: parsed.colors || { dominant: "#ffffff", palette: [] },
    });
  } catch (error) {
    console.error("Gemini API Error:", error);
    let errMsg = error.message || "Failed to process image with Gemini";
    if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("invalid API key")) {
      errMsg = "আপনার Gemini API Key টি সঠিক নয়। অনুগ্রহ করে aistudio.google.com থেকে সঠিক Key দিন।";
    }
    return NextResponse.json(
      { success: false, error: errMsg },
      { status: 500 }
    );
  }
}
