import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docu — Documentation to Offline PDF Converter",
  description: "Convert documentation websites into clean, searchable, offline PDF manuals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}

