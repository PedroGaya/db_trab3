# Neo4j

## Descrição e características do paradigma de armazenamento

O Neo4j armazena informação como um **grafo de propriedades**, onde entidades viram **nós** e as conexões entre elas viram **relacionamentos**, ambos podendo carregar atributos.

**Casos de uso:**

- **Redes sociais e comunidades**: identificar amizades, grupos, influenciadores, etc. Sugerir produtos, conteúdos ou conexões com base em padrões de relacionamento, não apenas em atributos isolados.
- **Análise de dependências**: rastrear impacto de mudanças em cadeias de suprimentos, arquiteturas de TI ou linhas de produção.
- **Grafos de conhecimento**: conectar entidades heterogêneas para busca semântica, assistentes e aplicações de IA que precisam de contexto relacional.

O Neo4j é um banco de dados de grafos **nativo**, criado em 2007 e escrito em Java e Scala. A linguagem de consulta é **Cypher**, declarativa e visualmente orientada a _pattern matching_. O SGBD também oferece transações ACID, suporte a clusters, etc.

O Neo4j pode ser usado em três formatos principais: **AuraDB** (serviço gerenciado na nuvem), **auto-gerenciado em nuvem** (AWS, GCP ou Azure) ou **instalação local**.

O armazenamento do Neo4j é baseado em **arquivos de registros de tamanho fixo**, separados por tipo de entidade. Os três arquivos centrais são `nodestore.db`, `relationshipsstore.db` e `propertystore.db`.

O Neo4j disponibiliza técnicas padrão de escalabilidade, como **clusters e replicação para leitura** e **sharding**. Além disso, proporciona o **Infinigraph**, que é voltada para grafos com alto volume de propriedades.

## Aplicações reais que usam o SGBD no mercado

**Uber.** A Uber construiu um **Config Knowledge Graph** no Neo4j AuraDB para validar configurações de negócio entre milhares de microserviços e milhares de feature flags.

**Telecom, cadeia de suprimentos e manufatura.** Empresas do setor usam o Neo4j para representar a cadeia como um grafo de componentes interconectados e aplicar algoritmos para analisar rotas, disponibilidade e dependências.

**Detecção de fraude e risco.** O paradigma de grafos é usado para identificar padrões de conluio e redes de transações anômalas, um tipo de análise em que a estrutura das conexões importa tanto quanto os valores individuais.

## Resultados

**SQLite** _ganha_ em consultas simples de usuário (`getUser` 15,3x), agregações (`usersPerCity` 5,85x; `topFollowed` 1,11x), multi-salto limitado (`mutualFollows` 7,04x) e, sobretudo, escritas (`createUser` 38,2x; `follow` 48,8x; `deleteUser` 28,9x). Também é mais rápido na carga de usuários e posts. Já perde em travessias profundas e caminhos mínimos (`shortestPath` 87,3x mais lento; `reachable` prof. 3 2,68x mais lento), pior latência de cauda e crescimento muito mais acentuado com escala (`shortestPath`: 125,46x vs. 3,31x).

Por consequência, **Neo4j** _ganha_ em travessias profundas (`shortestPath` 87,3x; `reachable` prof. 3 2,68x; prof. 6 2,04x), `timeline` 1,96x, carga de `follows` 1,66x e tempo total de carga 1,39x. Escala muito melhor em consultas gráficas e menor latência de cauda. Escritas e consultas simples/agregações são bem mais lentas, além de carga de usuários/posts inferior.

| Dimensão             | Métrica                                                      |      SQLite |         Neo4j | Unidade  | Vencedor |  Razão |
| -------------------- | ------------------------------------------------------------ | ----------: | ------------: | -------- | -------- | -----: |
| Consultas simples    | Mediana de getUser                                           |    **0.09** |         1.376 | ms       | SQLite   | 15.29x |
|                      | Mediana de following                                         |    **1.69** |         1.918 | ms       | SQLite   |  1.13x |
|                      | Mediana de followers                                         |       1.736 |      **1.39** | ms       | Neo4j    |  1.25x |
| Agregações           | Mediana de usersPerCity                                      |   **4.144** |        24.231 | ms       | SQLite   |  5.85x |
|                      | Mediana de topFollowed                                       | **377.248** |       417.403 | ms       | SQLite   |  1.11x |
| Multi-salto limitado | Mediana de recommend                                         |   **1.087** |          1.81 | ms       | SQLite   |  1.67x |
|                      | Mediana de mutualFollows                                     |   **0.545** |         3.838 | ms       | SQLite   |  7.04x |
|                      | Mediana de timeline                                          |       3.246 |     **1.657** | ms       | Neo4j    |  1.96x |
| Travessia profunda   | Mediana de reachable (profundidade 3)                        |      30.496 |    **11.399** | ms       | Neo4j    |  2.68x |
|                      | Mediana de shortestPath (máx. 6 saltos)                      |     757.136 |     **8.672** | ms       | Neo4j    | 87.31x |
|                      | Mediana de reachable (profundidade 6)                        |   2,066.264 | **1,012.354** | ms       | Neo4j    |  2.04x |
| Latência de cauda    | p95 / mediana de shortestPath (máx. 6 saltos)                |         4.2 |      **1.51** | x        | Neo4j    |  2.78x |
|                      | p95 / mediana de recommend                                   |        1.78 |      **1.35** | x        | Neo4j    |  1.32x |
|                      | p95 / mediana de reachable (profundidade 6)                  |        1.87 |      **1.32** | x        | Neo4j    |  1.42x |
| Throughput           | Carga de usuários                                            |  **22,649** |        16,859 | linhas/s | SQLite   |  1.34x |
|                      | Carga de posts                                               |  **26,215** |        20,324 | linhas/s | SQLite   |  1.29x |
|                      | Carga de follows                                             |      12,497 |    **20,800** | linhas/s | Neo4j    |  1.66x |
|                      | Tempo total de carga                                         |    95,950.9 |  **68,813.5** | ms       | Neo4j    |  1.39x |
| Escritas             | Mediana de createUser                                        |   **0.073** |         2.785 | ms       | SQLite   | 38.15x |
|                      | Mediana de follow                                            |   **0.058** |          2.83 | ms       | SQLite   | 48.79x |
|                      | Mediana de createPost                                        |   **0.323** |         2.828 | ms       | SQLite   |  8.76x |
|                      | Mediana de deleteUser (cascata)                              |   **0.122** |         3.528 | ms       | SQLite   | 28.92x |
| Escalabilidade       | Crescimento da mediana de getUser (1k -> 100k usuários)      |        0.59 |      **0.37** | x        | Neo4j    |  1.59x |
|                      | Crescimento da mediana de recommend (1k -> 100k usuários)    |         4.1 |      **0.79** | x        | Neo4j    |  5.19x |
|                      | Crescimento da mediana de usersPerCity (1k -> 100k usuários) |       40.23 |     **11.32** | x        | Neo4j    |  3.55x |
|                      | Crescimento da mediana de reachable (1k -> 100k usuários)    |        16.4 |      **1.46** | x        | Neo4j    | 11.23x |
|                      | Crescimento da mediana de shortestPath (1k -> 100k usuários) |      125.46 |      **3.31** | x        | Neo4j    |  37.9x |
