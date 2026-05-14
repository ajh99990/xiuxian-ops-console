import { useEffect, useState } from 'react';
import { GameViewPanel } from './components/GameViewPanel';
import { MessageBanner } from './components/MessageBanner';
import { ScriptRail } from './components/ScriptRail';
import { ShellHeader } from './components/ShellHeader';
import { useOpsConsole } from './hooks/useOpsConsole';
import { DashboardPage } from './pages/DashboardPage';
import { DailyCultivationPage } from './pages/DailyCultivationPage';
import { RoleOverviewPage } from './pages/RoleOverviewPage';

function pageFromHash() {
  const page = window.location.hash.replace(/^#\/?/, '');
  if (page === 'daily') return 'daily';
  if (page === 'roles') return 'roles';
  return 'dashboard';
}

function hashForPage(page) {
  if (page === 'roles') return '#/roles';
  return page === 'daily' ? '#/daily' : '#/';
}

export default function App() {
  const ops = useOpsConsole();
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(nextPage) {
    window.location.hash = hashForPage(nextPage);
    setPage(nextPage);
  }

  return (
    <main className="mx-auto w-[min(1520px,calc(100vw-48px))] py-7 max-[1240px]:w-[min(calc(100vw-24px),980px)]">
      <ShellHeader
        busy={ops.busy}
        onNavigate={navigate}
        onRefresh={ops.refresh}
        onStartAll={ops.startAll}
        onStopAll={ops.stopAll}
        page={page}
      />
      <MessageBanner message={ops.message} />

      {page === 'roles' ? (
        <RoleOverviewPage
          busy={ops.busy}
          onRefresh={ops.refreshRoleStates}
          roles={ops.jobs}
          roleStates={ops.roleStates}
        />
      ) : page === 'daily' ? (
        <DailyCultivationPage
          busy={ops.busy}
          dailyCultivation={ops.dailyCultivation}
          onRunDaily={ops.runDailyCultivation}
          roles={ops.jobs}
        />
      ) : (
        <>
          <DashboardPage {...ops} />
          <GameViewPanel gameView={ops.gameView} onClose={() => ops.setGameView(null)} />
          <ScriptRail scripts={ops.scripts} />
        </>
      )}
    </main>
  );
}
