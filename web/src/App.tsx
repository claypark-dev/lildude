import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { OnboardingGuard } from './components/OnboardingGuard.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Chat } from './pages/Chat.tsx';
import { Tasks } from './pages/Tasks.tsx';
import { Settings } from './pages/Settings.tsx';
import { Briefing } from './pages/Briefing.tsx';
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
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
