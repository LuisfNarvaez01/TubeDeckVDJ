import { create } from 'zustand';
import type { AccountStatus } from '../../shared/types';

interface AccountStore {
  status: AccountStatus | null;
  setStatus: (status: AccountStatus) => void;
}

/** The Lantify account Proyecta is signed in with (Settings → Cuenta, header). */
export const useAccountStore = create<AccountStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status })
}));
