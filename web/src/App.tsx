import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { OnboardingGuard } from './components/OnboardingGuard.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Chat } from './pages/Chat.tsx';
import { Tasks } from './pages/Tasks.tsx';
import { Settings } from './pages/Settings.tsx';
import { Briefing } from './pages/Briefing.tsx';
import { ShorebreakApprovals } from './pages/ShorebreakApprovals.tsx';
import { WavesHub } from './pages/WavesHub.tsx';
import { WavesHubHome } from './pages/waves/WavesHubHome.tsx';
import { WavesCategoryPage } from './pages/waves/WavesCategoryPage.tsx';
import { InstalledWaves } from './pages/waves/InstalledWaves.tsx';
import { PartyWaves } from './pages/PartyWaves.tsx';
import { Onboarding } from './pages/Onboarding.tsx';

/** Root application component with routing */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Onboarding page — no sidebar, no guard */}
        <Route path="/onboarding" element={<Onboarding />} />

        {/* Main app — guarded by onboarding check */}
        <Route element={<OnboardingGuard />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/briefing" element={<Briefing />} />
            <Route path="/shorebreak" element={<ShorebreakApprovals />} />
            <Route path="/hub" element={<WavesHub />}>
              <Route index element={<WavesHubHome />} />
              <Route path="category/:category" element={<WavesCategoryPage />} />
              <Route path="installed" element={<InstalledWaves />} />
            </Route>
            <Route path="/party-waves" element={<PartyWaves />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
