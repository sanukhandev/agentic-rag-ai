import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agentic RAG AI — Customer Assistant',
  description: 'Source-grounded, privacy-preserving conversational sales assistant'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#fafafa] text-[#111111] antialiased selection:bg-neutral-900 selection:text-white">
        {children}
      </body>
    </html>
  );
}
