# Requirements Document

## Introduction

A biblioteca `@flexicorp/telemetry-utils` unifica os três pilares de observabilidade (logs, métricas e tracing) em um único pacote npm reutilizável nos projetos da organização. A biblioteca preserva integralmente o padrão de logging da biblioteca de referência `@engebras/lib-logger` (baseada em Winston, com níveis e cores customizados, formatos de console estilizado e JSON, transporte Loki opcional e integração com OpenTelemetry via namespace `AsyncLocalStorage`). Adicionalmente, a biblioteca expõe instrumentação de métricas e traces, permitindo que o operador selecione um único destino de exportação por tipo de sinal entre o Grafana Alloy e um coletor OpenTelemetry OTLP, com host configurável.

## Glossary

- **Telemetry_Library**: O pacote npm `@flexicorp/telemetry-utils`, que unifica logs, métricas e tracing.
- **Logger**: Componente de logging da Telemetry_Library, baseado em `winston.Logger` estendido, que reproduz o padrão da biblioteca de referência.
- **Metrics_Provider**: Componente da Telemetry_Library responsável por registrar e exportar métricas.
- **Tracer_Provider**: Componente da Telemetry_Library responsável por criar e exportar spans de tracing.
- **Exporter**: Componente que transmite sinais de telemetria (logs, métricas ou traces) para um destino externo.
- **Alloy**: Grafana Alloy, agente coletor que recebe sinais de telemetria via protocolo OTLP e os encaminha para backends Grafana (Loki, Tempo, Prometheus).
- **OTLP_Collector**: Coletor OpenTelemetry que recebe sinais de telemetria via protocolo OTLP.
- **Export_Target**: O destino de exportação selecionado para um tipo de sinal, cujo valor permitido é `alloy` ou `otlp`.
- **Namespace**: Componente baseado em `AsyncLocalStorage` que armazena `correlationId` e `keyId` por requisição.
- **Span**: Unidade de tracing do OpenTelemetry representando uma operação com duração.
- **Correlation_Id**: Identificador de correlação de uma requisição, propagado via Namespace e injetado nos logs.
- **Log_Level**: Nível de log, cujo valor permitido é um dentre `crit`, `alert`, `http`, `error`, `warn`, `info`, `debug`, `verbose`.
- **Log_Format**: Formato de saída de log no console, cujo valor permitido é `json`, `text` ou `message`.
- **Host**: Endereço (URL) do destino de exportação (Alloy, OTLP_Collector ou Loki).
- **Trace_Context**: Par `traceId` e `spanId` do Span ativo no OpenTelemetry.
- **Telemetry_Bootstrap**: Módulo de inicialização importado por efeito colateral que configura e inicia o SDK OpenTelemetry Node antes do carregamento de módulos instrumentados.
- **Node_SDK**: Instância do SDK OpenTelemetry para Node.js que registra exportadores e instrumentações de telemetria.

## Requirements

### Requirement 1: Logging compatível com a biblioteca de referência

**User Story:** Como desenvolvedor, eu quero um Logger com o mesmo comportamento da biblioteca de referência, para que eu possa migrar projetos existentes sem alterar o formato de logs produzido.

#### Acceptance Criteria

1. THE Logger SHALL expor os níveis de log `crit` (0), `alert` (1), `http` (2), `error` (3), `warn` (4), `info` (5), `debug` (6) e `verbose` (7) com as mesmas prioridades numéricas da biblioteca de referência.
2. THE Logger SHALL associar uma cor de exibição a cada nível de log definido.
3. WHEN um registro de log é emitido, THE Logger SHALL incluir os campos `timestamp`, `level`, `service` e `message` no registro.
4. WHERE a variável de ambiente `LOG_FORMAT` possui o valor `text` ou `message`, THE Logger SHALL formatar a saída de console de forma estilizada, incluindo o contexto em PascalCase, o prefixo `[stage-service]` e o Correlation_Id truncado nos últimos 7 caracteres, utilizando o Correlation_Id integral quando este possuir 7 caracteres ou menos.
5. WHERE a variável de ambiente `LOG_FORMAT` possui o valor `json`, THE Logger SHALL formatar a saída de console no formato JSON.
6. WHERE a variável de ambiente `LOG_LEVEL` está definida com um dos valores de Log_Level permitidos, THE Logger SHALL emitir apenas registros cuja prioridade numérica seja igual ou inferior à prioridade numérica do Log_Level configurado, onde `crit` (0) representa a maior prioridade e `verbose` (7) a menor.
7. IF a variável de ambiente `LOG_LEVEL` não está definida, THEN THE Logger SHALL utilizar o Log_Level `info` como padrão.
8. IF a variável de ambiente `LOG_LEVEL` está definida com um valor fora do conjunto de Log_Level permitidos, THEN THE Logger SHALL utilizar o Log_Level `info` como padrão e registrar no console de erro uma mensagem indicando o valor inválido informado.
9. IF a variável de ambiente `LOG_FORMAT` não está definida ou possui um valor fora do conjunto `json`, `text` ou `message`, THEN THE Logger SHALL utilizar o formato de saída estilizado equivalente ao valor `text` como padrão.
10. WHEN um erro ocorre em um transporte de log, THE Logger SHALL registrar o erro no console de erro e continuar a operação sem interromper a emissão dos demais registros.

### Requirement 2: Contexto de requisição via Namespace

**User Story:** Como desenvolvedor, eu quero propagar um identificador de correlação por requisição, para que todos os logs de uma mesma requisição compartilhem o mesmo Correlation_Id.

#### Acceptance Criteria

1. WHEN o Namespace executa uma função através do método `run`, THE Namespace SHALL criar um escopo de armazenamento isolado para a execução dessa função, de modo que valores armazenados nesse escopo não sejam acessíveis a execuções concorrentes de outros escopos.
2. WHEN o método `setRequestId` é invocado dentro de um escopo ativo, THE Namespace SHALL armazenar o valor como Correlation_Id do escopo atual.
3. WHEN o método `getRequestId` é invocado dentro de um escopo ativo que possui Correlation_Id armazenado, THE Namespace SHALL retornar o Correlation_Id armazenado no escopo atual.
4. WHILE um escopo de Namespace está ativo, THE Logger SHALL incluir o Correlation_Id e o `keyId` do escopo em cada registro de log emitido.
5. IF nenhum escopo de Namespace está ativo quando um registro de log é emitido, THEN THE Logger SHALL emitir o registro sem os campos de Correlation_Id e `keyId`.
6. IF o método `setRequestId` é invocado quando nenhum escopo de Namespace está ativo, THEN THE Namespace SHALL não armazenar o valor e retornar uma indicação de ausência de escopo ativo sem interromper a execução.
7. IF o método `getRequestId` é invocado quando nenhum escopo de Namespace está ativo, OU quando o escopo ativo não possui Correlation_Id armazenado, THEN THE Namespace SHALL retornar um valor indefinido.

### Requirement 3: Integração de logs com tracing

**User Story:** Como desenvolvedor, eu quero que os logs incluam o contexto de tracing ativo, para que eu possa correlacionar logs e traces no Grafana.

#### Acceptance Criteria

1. WHEN um registro de log é emitido e existe um Span ativo, THE Logger SHALL incluir o `traceId` e o `spanId` do Trace_Context no registro.
2. IF nenhum Span está ativo quando um registro de log é emitido, THEN THE Logger SHALL emitir o registro sem os campos `traceId` e `spanId`.
3. WHEN o método `withTrace` é invocado com um nome e uma função assíncrona, THE Logger SHALL criar um Span ativo com o nome informado, executar a função dentro do contexto desse Span e, ao concluir a execução sem exceção, encerrar o Span e retornar ao chamador o valor resolvido pela função.
4. IF a função executada por `withTrace` lança uma exceção, THEN THE Logger SHALL registrar a exceção como evento de exceção no Span, definir o status do Span como erro, encerrar o Span e repropagar a mesma exceção ao chamador.

### Requirement 4: Exportação de métricas

**User Story:** Como desenvolvedor, eu quero registrar e exportar métricas da aplicação, para que eu possa monitorar indicadores de desempenho no Grafana.

#### Acceptance Criteria

1. THE Metrics_Provider SHALL expor uma interface para registrar métricas do tipo contador, histograma e medidor (gauge).
2. WHEN uma métrica é registrada através do Metrics_Provider, THE Metrics_Provider SHALL agregar o valor da métrica para exportação subsequente.
3. WHILE a exportação de métricas está habilitada, THE Metrics_Provider SHALL transmitir as métricas agregadas ao Export_Target configurado em intervalos periódicos de 60 segundos.
4. THE Metrics_Provider SHALL associar o nome do serviço (`APPLICATION_NAME`) e o estágio (`APP_STAGE`) como atributos de recurso das métricas exportadas.
5. IF a transmissão das métricas agregadas ao Export_Target falha, THEN THE Metrics_Provider SHALL registrar um erro indicando a falha de exportação, reter as métricas agregadas não transmitidas e retomar a transmissão no próximo intervalo periódico.
6. IF o tipo de métrica solicitado na interface de registro não é contador, histograma nem medidor (gauge), THEN THE Metrics_Provider SHALL rejeitar o registro e retornar um erro descritivo identificando o tipo de métrica inválido.

### Requirement 5: Exportação de traces

**User Story:** Como desenvolvedor, eu quero criar e exportar spans de tracing, para que eu possa analisar o fluxo distribuído das requisições no Grafana Tempo.

#### Acceptance Criteria

1. THE Tracer_Provider SHALL expor uma interface para criar Spans associados a operações nomeadas, aceitando nomes de operação com comprimento de 1 a 255 caracteres.
2. WHEN um Span é encerrado, THE Tracer_Provider SHALL enviar o Span ao Export_Target configurado para traces.
3. THE Tracer_Provider SHALL associar o nome do serviço (`APPLICATION_NAME`) e o estágio (`APP_STAGE`) como atributos de recurso dos Spans exportados.
4. WHEN um Span filho é criado dentro de um Span ativo, THE Tracer_Provider SHALL vincular o Span filho ao Trace_Context do Span pai; na ausência de Span ativo, THE Tracer_Provider SHALL criar o Span como Span raiz de um novo Trace_Context.
5. IF o envio de um Span ao Export_Target configurado falha, THEN THE Tracer_Provider SHALL registrar o erro no console de erro, descartar o Span cujo envio falhou e continuar a operação sem interromper o processamento dos demais Spans.

### Requirement 6: Seleção de destino de exportação

**User Story:** Como operador, eu quero escolher entre enviar a telemetria para o Alloy ou para um coletor OTLP, para que eu possa adaptar a biblioteca à infraestrutura de cada ambiente.

#### Acceptance Criteria

1. THE Telemetry_Library SHALL permitir a configuração do Export_Target com valor `alloy` ou `otlp` de forma independente para cada tipo de sinal de telemetria exportável (métricas e traces).
2. WHERE o Export_Target configurado é `alloy`, THE Exporter SHALL transmitir os sinais de telemetria ao Host do Alloy utilizando o protocolo OTLP.
3. WHERE o Export_Target configurado é `otlp`, THE Exporter SHALL transmitir os sinais de telemetria ao Host do OTLP_Collector utilizando o protocolo OTLP.
4. IF o valor configurado para o Export_Target não é `alloy` nem `otlp`, THEN THE Telemetry_Library SHALL rejeitar a configuração durante a inicialização, retornar um erro descritivo identificando o valor inválido e não inicializar o Exporter correspondente.
5. IF a transmissão de sinais de telemetria ao Host do Export_Target configurado falha, THEN THE Exporter SHALL registrar o erro de transmissão no console de erro, preservar os sinais pendentes para a próxima tentativa de exportação e continuar a operação sem encerrar o processo.
6. WHERE a variável de ambiente `LOKI_TRANSPORT` possui o valor `true`, THE Logger SHALL adicionar um transporte de logs para o Host do Loki.
7. IF a variável de ambiente `LOKI_TRANSPORT` não está definida ou possui valor diferente de `true`, THEN THE Logger SHALL não adicionar o transporte de logs para o Host do Loki.
8. IF a variável de ambiente `LOKI_HOST` não está definida enquanto `LOKI_TRANSPORT` possui o valor `true`, THEN THE Logger SHALL utilizar o Host padrão `http://loki.infra.svc.cluster.local:3100`.

### Requirement 7: Configuração via host e variáveis de ambiente

**User Story:** Como operador, eu quero configurar o host de destino e os parâmetros do serviço por variáveis de ambiente, para que eu possa alterar o comportamento da biblioteca sem modificar o código.

#### Acceptance Criteria

1. THE Telemetry_Library SHALL ler as variáveis de ambiente `APPLICATION_NAME`, `APP_STAGE`, `LOG_LEVEL`, `LOG_FORMAT`, `LOKI_TRANSPORT` e `LOKI_HOST`.
2. THE Telemetry_Library SHALL ler os endpoints de exportação OTLP de forma independente por sinal a partir das variáveis de ambiente `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` e `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`.
3. IF um dos endpoints OTLP por sinal não está definido, THEN THE Telemetry_Library SHALL utilizar o endpoint padrão correspondente apontando para o coletor da infraestrutura (`http://otel-collector.infra.svc.cluster.local:4318/v1/traces`, `/v1/logs` e `/v1/metrics` respectivamente).
4. IF a variável de ambiente `APPLICATION_NAME` não está definida, THEN THE Telemetry_Library SHALL utilizar o valor `unknown-service` como nome de serviço.
5. IF a variável de ambiente `APP_STAGE` não está definida, THEN THE Telemetry_Library SHALL utilizar o valor `unknown-stage` como estágio.
6. WHEN a Telemetry_Library é inicializada, THE Telemetry_Library SHALL aplicar os valores de configuração às instâncias de Logger, Metrics_Provider e Tracer_Provider.
7. IF um valor de configuração lido das variáveis de ambiente é inválido para o parâmetro correspondente durante a inicialização, THEN THE Telemetry_Library SHALL rejeitar a inicialização e retornar um erro descritivo identificando o parâmetro e o valor inválido, preservando o estado não inicializado.

### Requirement 8: Empacotamento e distribuição da biblioteca

**User Story:** Como desenvolvedor, eu quero consumir a biblioteca como um pacote npm compatível com os projetos existentes, para que eu possa reutilizá-la sem conflitos de build ou runtime.

#### Acceptance Criteria

1. THE Telemetry_Library SHALL ser compilada com `tsup` gerando artefatos no formato CommonJS carregáveis via `require`.
2. THE Telemetry_Library SHALL declarar `@opentelemetry/api` como peerDependency, sem incluí-la como dependência direta no artefato publicado.
3. THE Telemetry_Library SHALL declarar no manifesto do pacote o requisito de versão mínima de Node.js igual ou superior a 20.0.0.
4. IF a instalação do pacote ocorre em um ambiente com versão de Node.js inferior a 20.0.0, THEN THE Telemetry_Library SHALL emitir um aviso de incompatibilidade identificando a versão mínima exigida.
5. THE Telemetry_Library SHALL exportar o Logger, o Metrics_Provider, o Tracer_Provider e o Namespace como pontos de entrada públicos nomeados do pacote, acessíveis via importação a partir do pacote raiz.
6. THE Telemetry_Library SHALL gerar e publicar um arquivo de declarações de tipos TypeScript (`.d.ts`) cobrindo cada ponto de entrada público (Logger, Metrics_Provider, Tracer_Provider e Namespace).
7. THE Telemetry_Library SHALL expor o módulo de bootstrap de telemetria (Requirement 9) como um ponto de entrada de subcaminho dedicado importável por efeito colateral (ex.: `@flexicorp/telemetry-utils/tracing`).

### Requirement 9: Bootstrap do SDK de telemetria na inicialização do serviço

**User Story:** Como desenvolvedor, eu quero inicializar toda a telemetria importando um único módulo na primeira linha do serviço, para que as auto-instrumentações sejam registradas antes de qualquer módulo instrumentado ser carregado.

#### Acceptance Criteria

1. WHEN o Telemetry_Bootstrap é carregado, THE Telemetry_Bootstrap SHALL carregar as variáveis de ambiente via `dotenv` antes de configurar o Node_SDK.
2. THE Telemetry_Bootstrap SHALL configurar o nível de diagnóstico do OpenTelemetry a partir da variável de ambiente `OTEL_LOG_LEVEL`.
3. IF a variável de ambiente `OTEL_LOG_LEVEL` não está definida ou possui um valor inválido, THEN THE Telemetry_Bootstrap SHALL utilizar o nível de diagnóstico `WARN` como padrão.
4. WHERE a variável de ambiente `KUBERNETES` possui o valor `true`, THE Telemetry_Bootstrap SHALL instanciar e iniciar o Node_SDK com exportadores OTLP HTTP independentes para traces, logs e métricas.
5. IF a variável de ambiente `KUBERNETES` não possui o valor `true`, THEN THE Telemetry_Bootstrap SHALL não iniciar o Node_SDK e SHALL registrar no console que a telemetria foi ignorada em modo local.
6. WHEN o Node_SDK é iniciado, THE Node_SDK SHALL registrar as auto-instrumentações para Node.js, incluindo a instrumentação de runtime e a instrumentação de Winston.
7. WHEN uma requisição HTTP de entrada é destinada à rota `/metrics`, THE Node_SDK SHALL ignorar a instrumentação dessa requisição HTTP de entrada.
8. WHEN o Node_SDK é iniciado, THE Node_SDK SHALL definir os atributos de recurso `service.name`, `service_namespace` e `deployment.environment` a partir das variáveis de ambiente `APPLICATION_NAME`, `SERVICE_NAMESPACE` e `APP_STAGE` respectivamente.
9. WHILE o Node_SDK está em execução, THE Node_SDK SHALL exportar métricas em intervalos periódicos de 60 segundos.
10. WHEN o processo recebe o sinal `SIGTERM` ou `SIGINT`, THE Telemetry_Bootstrap SHALL encerrar o Node_SDK de forma graciosa antes de terminar o processo.
11. THE Telemetry_Bootstrap SHALL ser importável como a primeira instrução do ponto de entrada do serviço, de modo que o Node_SDK seja iniciado antes do carregamento de módulos instrumentados.
