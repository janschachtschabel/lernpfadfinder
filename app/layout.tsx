import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dein Lernpfadfinder',
  description: 'Sag dein Lernziel, markiere dein Vorwissen – und bekomme einen persönlichen Lernpfad mit passenden Materialien aus WirLernenOnline.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
