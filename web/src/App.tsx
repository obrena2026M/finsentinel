import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth.tsx';
import { AiReviewProvider } from './components/AiReviewModal.tsx';
import { ContextPanelProvider } from './components/ContextPanel.tsx';
import { Loading } from './components/common.tsx';
import { Shell } from './components/Shell.tsx';
import { AdminRiskModelPage } from './pages/AdminRiskModelPage.tsx';
import { CasePage } from './pages/CasePage.tsx';
import { CasesPage } from './pages/CasesPage.tsx';
import { NewCasePage } from './pages/NewCasePage.tsx';
import { OpsPage } from './pages/OpsPage.tsx';
import { QualityPage } from './pages/QualityPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { ToastProvider } from './toast.tsx';

// Routes per UX §2. Plain component router API (BrowserRouter/Routes/Route).

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <Loading what="Checking session" />
      </div>
    );
  }
  if (!me) return <Navigate to="/signin" replace state={{ from: location.pathname + location.hash }} />;
  return (
    <ContextPanelProvider>
      <Shell>{children}</Shell>
    </ContextPanelProvider>
  );
}

function SignInRoute() {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (me) return <Navigate to="/cases" replace />;
  return <SignInPage />;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AiReviewProvider>
            <Routes>
              <Route path="/signin" element={<SignInRoute />} />
              <Route
                path="/cases"
                element={
                  <RequireAuth>
                    <CasesPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/cases/new"
                element={
                  <RequireAuth>
                    <NewCasePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/cases/:id"
                element={
                  <RequireAuth>
                    <CasePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/quality"
                element={
                  <RequireAuth>
                    <QualityPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/ops"
                element={
                  <RequireAuth>
                    <OpsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/risk-model"
                element={
                  <RequireAuth>
                    <AdminRiskModelPage />
                  </RequireAuth>
                }
              />
              <Route path="/" element={<Navigate to="/cases" replace />} />
              <Route path="*" element={<Navigate to="/cases" replace />} />
            </Routes>
          </AiReviewProvider>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
