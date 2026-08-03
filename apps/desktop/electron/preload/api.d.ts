import type { ApiOrbe } from './index';

declare global {
  interface Window {
    qh: ApiOrbe;
  }
}

export {};
