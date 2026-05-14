import { JobEditor } from '../components/jobs/JobEditor';
import { JobList } from '../components/jobs/JobList';
import { LogsPanel } from '../components/jobs/LogsPanel';

export function DashboardPage({
  addJob,
  busy,
  copyRecoveryId,
  jobs,
  logRef,
  logView,
  openGameView,
  removeSelected,
  runAction,
  scripts,
  selectJob,
  selectedJob,
  serializeJobs,
  updateSelected,
}) {
  const runningCount = jobs.filter((job) => job.runtime?.running).length;
  const enabledCount = jobs.filter((job) => job.enabled !== false).length;

  return (
    <section className="mt-7 grid min-h-[630px] grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(390px,470px)_minmax(520px,1fr)]">
      <JobList
        enabledCount={enabledCount}
        jobs={jobs}
        onAdd={addJob}
        onSelect={selectJob}
        runningCount={runningCount}
        selectedJob={selectedJob}
      />
      <JobEditor
        busy={busy}
        copyRecoveryId={copyRecoveryId}
        onOpenGame={openGameView}
        onRemove={removeSelected}
        onRunAction={runAction}
        scripts={scripts}
        selectedJob={selectedJob}
        serializeJobs={serializeJobs}
        updateSelected={updateSelected}
      />
      <LogsPanel
        busy={busy}
        logRef={logRef}
        logView={logView}
        onRunAction={runAction}
        selectedJob={selectedJob}
      />
    </section>
  );
}
