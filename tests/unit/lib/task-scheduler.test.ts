import { scheduleTask } from '@/lib/task-scheduler';

describe('scheduleTask', () => {
  it('executes tasks sequentially in order', async () => {
    const order: string[] = [];

    const taskA = scheduleTask('A', async () => {
      order.push('start-A');
      await new Promise((r) => setTimeout(r, 30));
      order.push('end-A');
      return 'A';
    });

    const taskB = scheduleTask('B', async () => {
      order.push('start-B');
      // Shorter task, but should still start after A finished
      await new Promise((r) => setTimeout(r, 5));
      order.push('end-B');
      return 'B';
    });

    const [a, b] = await Promise.all([taskA, taskB]);

    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(order).toEqual(['start-A', 'end-A', 'start-B', 'end-B']);
  });
});

