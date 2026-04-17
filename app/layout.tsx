import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WissenLebtOnline Lernpfadfinder',
  description: 'Finde deinen individuellen Lernpfad – von Wikidata zur Lernreihenfolge.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
