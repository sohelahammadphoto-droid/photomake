# 🎨 AI Image Editor

যেকোনো Design Image → AI দিয়ে Editable HTML Recreate

## ✅ Features
- 📸 Image upload (JPG/PNG/WEBP)
- 👁️ Gemini Vision AI analysis
- 🔍 Auto OCR — সব text extract
- 💻 HTML/CSS auto generate
- ✏️ Live text editor (left panel → right preview)
- 💾 HTML + PNG export

## 🚀 Vercel Deploy (3 Steps)

### Step 1: Gemini API Key নাও (Free)
1. https://aistudio.google.com এ যাও
2. "Get API Key" → Create API Key
3. Copy করে রাখো

### Step 2: Vercel এ Deploy
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. GitHub এ এই repo push করো
2. https://vercel.com → "New Project" → repo select
3. **Environment Variables** এ add করো:
   - Key: `GEMINI_API_KEY`
   - Value: তোমার Gemini API key
4. Deploy!

### Step 3: Local Test
```bash
cp .env.example .env.local
# .env.local এ GEMINI_API_KEY দাও
npm install
npm run dev
# http://localhost:3000
```

## 📁 Project Structure
```
app/
  page.jsx           ← Upload page
  editor/page.jsx    ← Live editor
  api/analyze/route.js ← Gemini API
  layout.jsx
  globals.css
```
