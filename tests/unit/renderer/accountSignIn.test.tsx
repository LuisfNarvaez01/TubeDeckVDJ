import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountStatus } from '../../../src/shared/types';
import { AccountSignIn, LAST_BUSINESS_CODE_KEY } from '../../../src/renderer/components/AccountGate';

const signedIn = (code: string): AccountStatus => ({
  state: 'signed-in',
  business: { code, name: 'Bar' },
  user: { name: 'Dueña', username: 'duena', role: 'ADMIN' },
  plan: 'pro',
  subscription: 'ACTIVE',
  offlineUntil: null,
  viaPos: false,
  error: null,
  businessChoices: null
});
const choose: AccountStatus = {
  ...signedIn('x'),
  state: 'signed-out',
  business: null,
  user: null,
  plan: null,
  subscription: null,
  businessChoices: [
    { code: 'BAR-AB12', name: 'Bar Nativos' },
    { code: 'CEN-9X', name: 'Bar Centro' }
  ]
};

function fill(): void {
  fireEvent.change(screen.getByLabelText('Usuario o correo'), { target: { value: 'duena@nativos.co' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave-1' } });
  fireEvent.click(screen.getByRole('button', { name: /^Entrar$/ }));
}

describe('AccountSignIn', () => {
  let signIn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    signIn = vi.fn();
    (window as unknown as { tubedeckAPI: unknown }).tubedeckAPI = {
      signIn,
      signInWithLocalPos: vi.fn(),
      openProyectaSignup: vi.fn()
    };
  });
  afterEach(cleanup);

  it('asks only for the username (or email) and password; the code is an optional link', () => {
    render(<AccountSignIn status={null} onSignedIn={() => undefined} />);
    expect(screen.queryByLabelText(/Código del negocio/)).toBeNull();
    expect(screen.getByText('La misma cuenta de Lantify POS (usuario o correo y contraseña).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar con el código del negocio' }));
    expect(screen.getByLabelText(/Código del negocio/)).toBeTruthy();
  });

  it('several businesses: shows them as buttons, signs in with the one picked and remembers it', async () => {
    signIn.mockResolvedValueOnce({ success: true, data: choose }).mockResolvedValueOnce({ success: true, data: signedIn('CEN-9X') });
    const onSignedIn = vi.fn();
    render(<AccountSignIn status={null} onSignedIn={onSignedIn} />);
    fill();
    await screen.findByText('¿Qué negocio vas a abrir?');
    expect(signIn.mock.calls[0][0]).toEqual({ tenantCode: undefined, username: 'duena@nativos.co', password: 'Clave-1' });
    fireEvent.click(screen.getByRole('button', { name: /Bar Centro/ }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signIn.mock.calls[1][0]).toEqual({ tenantCode: 'CEN-9X', username: 'duena@nativos.co', password: 'Clave-1' });
    expect(localStorage.getItem(LAST_BUSINESS_CODE_KEY)).toBe('CEN-9X');
  });

  it('sends the remembered business on later sign-ins, and "Cambiar" forgets it', async () => {
    localStorage.setItem(LAST_BUSINESS_CODE_KEY, 'CEN-9X');
    signIn.mockResolvedValue({ success: true, data: signedIn('CEN-9X') });
    render(<AccountSignIn status={null} onSignedIn={() => undefined} />);
    expect(screen.getByText('CEN-9X')).toBeTruthy();
    fill();
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(signIn.mock.calls[0][0].tenantCode).toBe('CEN-9X');

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(localStorage.getItem(LAST_BUSINESS_CODE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Entrar con el código del negocio' })).toBeTruthy();
  });
});
