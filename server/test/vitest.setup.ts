import { vi } from 'vitest';

// Keep existing tests working without rewriting jest.* helpers.
declare global {
  var jest: typeof vi;
}

globalThis.jest = vi;
