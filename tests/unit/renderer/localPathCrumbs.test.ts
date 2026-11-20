import { describe, expect, it } from 'vitest';
import { pathCrumbs } from '../../../src/renderer/components/LocalLibraryTab';

describe('pathCrumbs', () => {
  it('splits a Windows path into clickable segments', () => {
    expect(pathCrumbs('D:\\Música\\Salsa')).toEqual([
      { label: 'D:', path: 'D:\\' },
      { label: 'Música', path: 'D:\\Música' },
      { label: 'Salsa', path: 'D:\\Música\\Salsa' }
    ]);
  });

  it('handles POSIX paths', () => {
    expect(pathCrumbs('/media/usb')).toEqual([
      { label: 'media', path: '/media' },
      { label: 'usb', path: '/media/usb' }
    ]);
  });
});
