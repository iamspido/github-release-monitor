// vitest globals enabled

const { cacheMocks } = vi.hoisted(() => ({
  cacheMocks: {
    revalidateTag: vi.fn(),
  },
}));

vi.mock('next/cache', () => cacheMocks);

describe('simple actions', () => {
  it('revalidateReleasesAction calls revalidateTag("github-releases")', async () => {
    const { revalidateReleasesAction } = await import('@/app/actions');
    await revalidateReleasesAction();
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith('github-releases');
  });

  it('getJobStatusAction returns stored status', async () => {
    const { setJobStatus } = await import('@/lib/job-store');
    const { getJobStatusAction } = await import('@/app/actions');
    setJobStatus('job-xyz', 'pending');
    const res = await getJobStatusAction('job-xyz');
    expect(res.status).toBe('pending');
  });
});
