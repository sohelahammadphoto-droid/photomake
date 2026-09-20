import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { imageBase64, mimeType, filename } = await request.json();

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imagePart = {
      inlineData: { data: imageBase64, mimeType },
    };

    // ── Step 1: Vision Analysis ──
    const visionResult = await model.generateContent([
      `Analyze this design image for pixel-perfect HTML/CSS recreation. Describe in detail:
1. Background (exact colors, gradient direction, pattern)
2. Layout structure and sections
3. Typography (fonts, weights, sizes, styles)
4. Visual hierarchy (main heading, subheading, body text positions)
5. Decorative elements (shapes, lines, icons, borders, shadows)
6. Color scheme (list exact colors used)
7. Spacing, padding, alignment
8. Overall design style

Be very technical and specific. This will be used to generate exact HTML/CSS code.`,
      imagePart,
    ]);
    const visionDesc = visionResult.response.text();

    // ── Step 2: OCR — Extract all text with positions ──
    const ocrResult = await model.generateContent([
      `Extract ALL text from this image. For each text element, provide a JSON array with:
- "id": unique id like "txt_1", "txt_2"
- "text": the exact text content
- "left": left position as percentage of image width (0-100)
- "top": top position as percentage of image height (0-100)
- "width": width as percentage of image width
- "height": height as percentage of image height
- "fontSize": approximate font size in pixels
- "fontWeight": "normal", "bold", or "900"
- "color": estimated text color as hex code
- "align": "left", "center", or "right"
- "role": "heading", "subheading", "body", "label", "button", or "decoration"

Return ONLY a valid JSON array, no markdown, no explanation.`,
      imagePart,
    ]);

    let ocrText = ocrResult.response.text().trim();
    // Clean JSON
    if (ocrText.includes("```")) {
      ocrText = ocrText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }

    let texts = [];
    try {
      texts = JSON.parse(ocrText);
    } catch {
      // Fallback: extract with regex
      const match = ocrText.match(/\[[\s\S]*\]/);
      if (match) texts = JSON.parse(match[0]);
    }

    // ── Step 3: HTML/CSS Generation ──
    const htmlResult = await model.generateContent([
      `Create a complete, pixel-perfect HTML file that exactly replicates this design.

VISION ANALYSIS:
${visionDesc}

EXTRACTED TEXT ELEMENTS (JSON):
${JSON.stringify(texts, null, 2)}

REQUIREMENTS:
1. Use a .canvas container: position:relative; width:100%; overflow:hidden;
2. Use .content: position:absolute; top:0; left:0; right:0; bottom:0;
3. Each text element: position:absolute with left/top as % from OCR data
4. Every text div MUST have: id="[id from OCR]" data-editable="true"
5. Match background colors/gradients from vision analysis exactly
6. Import Google Fonts (Inter + Noto Sans Bengali)
7. Add all decorative elements (shapes, borders, icons) from vision analysis
8. Make it standalone — no external dependencies except Google Fonts CDN

Output ONLY the complete HTML starting with <!DOCTYPE html>, no markdown fences.`,
      imagePart,
    ]);

    let generatedHTML = htmlResult.response.text().trim();
    // Clean fences
    if (generatedHTML.includes("```html")) {
      generatedHTML = generatedHTML.split("```html")[1].split("```")[0].trim();
    } else if (generatedHTML.includes("```")) {
      generatedHTML = generatedHTML.split("```")[1].split("```")[0].trim();
    }

    return Response.json({
      success: true,
      visionDescription: visionDesc,
      texts,
      generatedHTML,
      filename,
    });
  } catch (err) {
    console.error("API Error:", err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
