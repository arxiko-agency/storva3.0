import { describe, expect, it } from 'vitest';
import { safeRedirect } from '@/lib/auth-redirect';

describe('safeRedirect', () => {
  it('keeps same-origin paths', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard');
    expect(safeRedirect('/products')).toBe('/products');
  });
  it('blocks other sites', () => {
    expect(safeRedirect('//evil.example')).toBe('/dashboard');
    expect(safeRedirect('https://evil.example')).toBe('/dashboard');
    expect(safeRedirect('/\\evil.example')).toBe('/dashboard');
  });
  it('uses the fallback for non-strings', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });
});
