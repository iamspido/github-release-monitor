import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges class names and removes falsy values', () => {
    const result = cn('a', undefined, null, false as any, 'b', 0 as any, '', 'c');
    expect(result).toBe('a b c');
  });

  it('merges conflicting tailwind classes correctly', () => {
    const result = cn('p-2', 'p-4', 'text-sm', 'text-lg');
    expect(result).toBe('p-4 text-lg');
  });
});

