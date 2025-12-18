// vitest globals enabled

const { cacheMocks } = vi.hoisted(() => ({
  cacheMocks: {
    updateTag: vi.fn(),
  },
}));

vi.mock('next/cache', () => cacheMocks);

describe('simple actions', () => {
  it('revalidateReleasesAction calls updateTag for all release caches', async () => {
    const { revalidateReleasesAction } = await import('@/app/actions');
    await revalidateReleasesAction();
    expect(cacheMocks.updateTag).toHaveBeenCalledWith('github-releases');
    expect(cacheMocks.updateTag).toHaveBeenCalledWith('codeberg-releases');
  });

  it('getJobStatusAction returns stored status', async () => {
    const { setJobStatus } = await import('@/lib/job-store');
    const { getJobStatusAction } = await import('@/app/actions');
    setJobStatus('job-xyz', 'pending');
    const res = await getJobStatusAction('job-xyz');
    expect(res.status).toBe('pending');
  });
});
