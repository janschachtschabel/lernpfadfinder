'use client';
import { useStore } from '@/lib/store';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { GraphView } from '@/components/GraphView';

export default function HomePage() {
  const phase = useStore(s => s.phase);
  if (phase === 'welcome') return <WelcomeScreen />;
  return <GraphView />;
}
