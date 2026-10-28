export function shouldAutoCollapseGenerationPanel(jobs: readonly { status: string }[]): boolean {
  return jobs.length > 0 && !jobs.some((job) =>
    job.status === 'running' || job.status === 'stopping' || job.status === 'failed'
  );
}
