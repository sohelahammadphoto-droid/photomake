import "./globals.css";
export const metadata = {
  title: "AI Image Editor - Photo to Editable HTML",
  description: "Upload any design image and get an editable HTML version with AI",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[#090a0f] text-slate-100 min-h-screen antialiased selection:bg-violet-500/30 selection:text-violet-200">{children}</body>
    </html>
  );
}
