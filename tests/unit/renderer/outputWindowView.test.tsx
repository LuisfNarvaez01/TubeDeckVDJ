import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputWindowView } from '../../../src/renderer/components/OutputWindowView';

describe('OutputWindowView', () => {
  it('renders a clean borderless fullscreen video without controls and assigns received stream', () => {
    const fakeStream = {} as MediaStream;
    render(<OutputWindowView externalStream={fakeStream} />);

    const video = screen.getByTestId('output-master-video') as HTMLVideoElement;
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.srcObject).toBe(fakeStream);
  });
});

