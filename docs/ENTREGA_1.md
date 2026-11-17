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
