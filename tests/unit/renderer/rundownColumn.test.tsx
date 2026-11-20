import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RundownColumn } from '../../../src/renderer/components/RundownColumn';

const t = (id: string, title: string) => ({
  videoId: id,
  title,
  channel: 'Artista',
  durationSec: 200,
  thumbnailUrl: '',
  isLive: false
});

describe('RundownColumn', () => {
  it('lists the next songs with load and remove actions', () => {
    const onLoad = vi.fn();
    const onRemove = vi.fn();
    render(
      <RundownColumn
        title="Siguientes"
        emptyText="vacía"
        tracks={[t('a0000000001', 'Rumores'), t('b0000000001', 'Creo en Mí')]}
        onLoadToDeck={onLoad}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText('+1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar Creo en Mí en el deck B' }));
    expect(onLoad).toHaveBeenCalledWith('B', expect.objectContaining({ videoId: 'b0000000001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Rumores de la cola' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'a0000000001' }), 0);
  });

  it('shows the empty text', () => {
    render(<RundownColumn title="Anteriores" emptyText="Aquí aparecerá lo que ya sonó." tracks={[]} onLoadToDeck={vi.fn()} />);
    expect(screen.getByText('Aquí aparecerá lo que ya sonó.')).toBeTruthy();
  });
});
