/**
 * Namespace de contexto de requisição baseado em `AsyncLocalStorage`.
 *
 * Propaga `correlationId` (Correlation_Id) e `keyId` por requisição, de modo que
 * cada execução iniciada via {@link Namespace.run} possua um escopo de armazenamento
 * isolado e inacessível a execuções concorrentes (R2.1).
 *
 * Fora de um escopo ativo, as operações de escrita são no-op (não interrompem a
 * execução) e as de leitura retornam `null`/`undefined` (R2.6, R2.7).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Formato do store mantido por escopo. Cada campo é opcional e pode armazenar
 * qualquer tipo informado pelo chamador via os métodos genéricos.
 */
interface NamespaceStore {
  correlationId?: unknown;
  keyId?: unknown;
}

export class Namespace {
  private readonly storage = new AsyncLocalStorage<NamespaceStore>();

  /**
   * Indica se há um escopo de Namespace ativo na execução atual (R2.5).
   */
  isActived(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /**
   * Cria um escopo de armazenamento isolado e executa `fn` dentro dele (R2.1).
   * Valores armazenados neste escopo não são acessíveis a execuções concorrentes
   * de outros escopos.
   */
  run(fn: () => void): void {
    this.storage.run({}, fn);
  }

  /**
   * Armazena o valor como Correlation_Id do escopo ativo (R2.2).
   * Fora de um escopo ativo, é um no-op que não interrompe a execução (R2.6).
   */
  setRequestId<T>(value: T): void {
    const store = this.storage.getStore();
    if (store === undefined) {
      return;
    }
    store.correlationId = value;
  }

  /**
   * Lê o Correlation_Id do escopo ativo (R2.3).
   * Fora de escopo, ou quando o escopo não possui valor armazenado, retorna `null` (R2.7).
   */
  getRequestId<T>(): T | null {
    const store = this.storage.getStore();
    if (store === undefined || store.correlationId === undefined) {
      return null;
    }
    return store.correlationId as T;
  }

  /**
   * Armazena o valor como `keyId` do escopo ativo (R2.2).
   * Fora de um escopo ativo, é um no-op que não interrompe a execução (R2.6).
   */
  setkeyId<T>(value: T): void {
    const store = this.storage.getStore();
    if (store === undefined) {
      return;
    }
    store.keyId = value;
  }

  /**
   * Lê o `keyId` do escopo ativo (R2.3).
   * Fora de escopo, ou quando o escopo não possui valor armazenado, retorna `undefined` (R2.7).
   */
  getkeyId<T>(): T | undefined {
    const store = this.storage.getStore();
    if (store === undefined || store.keyId === undefined) {
      return undefined;
    }
    return store.keyId as T;
  }
}

/**
 * Instância default compartilhada do Namespace (R2 / design "Namespace").
 */
export default new Namespace();
