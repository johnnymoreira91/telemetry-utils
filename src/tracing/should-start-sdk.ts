/**
 * Decisão pura de ativação do Node_SDK (R9.4, R9.5).
 *
 * Isola, em uma função totalmente pura (sem efeitos colaterais), a regra que
 * governa a inicialização do SDK OpenTelemetry no bootstrap: o SDK só deve ser
 * iniciado quando a variável de ambiente `KUBERNETES` possui exatamente o valor
 * `'true'`. Para qualquer outro valor (ausente, vazio, `'TRUE'`, `'1'`, etc.) a
 * decisão é negativa e o bootstrap permanece em modo local.
 *
 * O módulo de bootstrap por efeito colateral (`src/tracing/index.ts`, tarefa
 * 13.3) consome esta função para decidir se instancia e inicia o `NodeSDK`,
 * mantendo a lógica de decisão testável de forma isolada.
 */

/**
 * Decide se o Node_SDK deve ser iniciado com base no valor de `KUBERNETES`.
 *
 * Função pura: não lê o ambiente, não registra logs e não produz efeitos
 * colaterais — apenas avalia o valor recebido.
 *
 * @param kubernetesEnvValue Valor da variável de ambiente `KUBERNETES`
 *   (tipicamente `process.env.KUBERNETES`), que pode ser `undefined`.
 * @returns `true` se e somente se o valor for exatamente a string `'true'`;
 *   `false` para qualquer outro valor (R9.4, R9.5).
 */
export function shouldStartSdk(kubernetesEnvValue: string | undefined): boolean {
  return kubernetesEnvValue === 'true';
}
