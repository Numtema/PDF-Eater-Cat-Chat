import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'PDF Eater Cat Chat',
  description: 'An interactive AI chat that eats your PDF and becomes a document expert.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body className="antialiased bg-stone-50 text-stone-900 min-h-screen font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
