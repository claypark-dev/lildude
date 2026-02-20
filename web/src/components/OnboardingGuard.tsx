import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { fetchOnboardingStatus } from '../lib/api.ts';

/**
 * Route guard that redirects to /onboarding if the app has not been set up.
 * Wraps main app routes; renders <Outlet /> when onboarded.
 */
export function OnboardingGuard() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchOnboardingStatus()
      .then((status) => {
        if (!status.onboarded) {
          navigate('/onboarding', { replace: true });
        }
      })
      .catch(() => {
        // If the API is unreachable, let the user through
        // (they'll see errors elsewhere if the backend is down)
      })
      .finally(() => {
        setChecking(false);
      });
  }, [navigate]);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <Outlet />;
}
