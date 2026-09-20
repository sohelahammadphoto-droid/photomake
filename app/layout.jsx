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
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
