'use client';
import { useStore } from '@/lib/store';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { BaselineScreen } from '@/components/BaselineScreen';
import { GraphView } from '@/components/GraphView';
import { SessionPersister } from '@/components/SessionPersister';

export default function HomePage() {
  const phase = useStore(s => s.phase);
  return (
    <>
      <SessionPersister />
      {phase === 'welcome'
        ? <WelcomeScreen />
        : phase === 'baseline'
          ? <BaselineScreen />
          : <GraphView />}
    </>
  );
}
