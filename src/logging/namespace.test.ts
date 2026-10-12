/**
 * Testes basicos do Namespace (AsyncLocalStorage) — base de @engebras/lib-logger.
 */
import { describe, expect, it } from 'vitest';
import defaultNamespace, { Namespace } from './namespace';

describe('Namespace', () => {
  it('isActived é false fora de um escopo e true dentro de run()', () => {
    const ns = new Namespace();
    expect(ns.isActived()).toBe(false);
    ns.run(() => {
      expect(ns.isActived()).toBe(true);
    });
    expect(ns.isActived()).toBe(false);
  });

  it('round-trip: setRequestId/getRequestId dentro do escopo', () => {
    const ns = new Namespace();
    let read: string | null = 'x';
    ns.run(() => {
      ns.setRequestId('req-123');
      read = ns.getRequestId<string>();
    });
    expect(read).toBe('req-123');
  });

  it('round-trip: setkeyId/getkeyId dentro do escopo', () => {
    const ns = new Namespace();
    let read: string | undefined = 'x';
    ns.run(() => {
      ns.setkeyId('key-abc');
      read = ns.getkeyId<string>();
    });
    expect(read).toBe('key-abc');
  });

  it('fora de escopo: set* é no-op e get* retorna null/undefined', () => {
    const ns = new Namespace();
    expect(() => ns.setRequestId('x')).not.toThrow();
    expect(() => ns.setkeyId('y')).not.toThrow();
    expect(ns.getRequestId()).toBeNull();
    expect(ns.getkeyId()).toBeUndefined();
  });

  it('escopos sequenciais não compartilham valores', () => {
    const ns = new Namespace();
    let a: string | null = null;
    let b: string | null = null;
    ns.run(() => { ns.setRequestId('A'); a = ns.getRequestId<string>(); });
    ns.run(() => { b = ns.getRequestId<string>(); });
    expect(a).toBe('A');
    expect(b).toBeNull();
  });

  it('isolamento entre escopos assíncronos concorrentes', async () => {
    const ns = new Namespace();
    const run = (id: string, delay: number) =>
      new Promise<string | null>((resolve) => {
        ns.run(() => {
          ns.setRequestId(id);
          setTimeout(() => resolve(ns.getRequestId<string>()), delay);
        });
      });
    const [r1, r2] = await Promise.all([run('one', 5), run('two', 1)]);
    expect(r1).toBe('one');
    expect(r2).toBe('two');
  });

  it('exporta uma instância default compartilhada', () => {
    expect(defaultNamespace).toBeInstanceOf(Namespace);
  });
});
