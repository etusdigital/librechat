# Código adaptado do Open Design

Esta pasta guarda o código da tela Design que vem do Open Design (https://github.com/nexu-io/open-design), licenciado sob a Apache-2.0 (cópia em `LICENSE`).

| Item                  | Valor                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Repositório de origem | https://github.com/nexu-io/open-design                                                                           |
| Commit                | `802708f6c9f294347ef777b1fda49b9cbe26ef72` (o mesmo de `design-assets/config/upstream.lock.json` no etus-design) |
| Licença               | Apache-2.0                                                                                                       |

## O que veio

| Arquivo aqui        | Origem                                     | O que mudou                                                                                   |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `LICENSE`           | `LICENSE`                                  | nada (cópia exata)                                                                            |
| `source-patches.ts` | `apps/web/src/edit-mode/source-patches.ts` | reescrito para os seletores da ponte `etus:` e gravação só dos trechos alterados (ver abaixo) |

`source-patches.ts` veio com a edição inline (C8). O que mudou em relação ao original:

- O original aplica cada patch num documento lido com `DOMParser` e grava o arquivo inteiro serializado pelo DOM, com elementos achados por `data-od-id`. Aqui o elemento é achado pelo seletor CSS da ponte `etus:` (C 3.5) e a gravação troca só dois trechos do código: o texto do elemento e o atributo `style` da tag. Para saber onde fica cada tag no arquivo, um leitor de tags marca cada tag de abertura numa cópia do código antes do `DOMParser`; o resto do arquivo fica byte a byte igual.
- Ficaram do original: a leitura com `DOMParser`, a recusa de texto em elemento com marcação dentro e a regra de valor vazio remover a propriedade do `style`.
- Saíram: tokens, links, imagens, atributos, troca de HTML, remoção de elemento, brand kit e os overrides em tempo de execução.
- Entraram: validação de cada propriedade e valor pela lista de `preview/host-protocol.ts`, texto sempre escapado, conferência do texto do elemento antes de aplicar (o elemento ainda é o mesmo) e um segundo `DOMParser` no resultado, que recusa a gravação se a estrutura do documento mudou ou se o texto e o estilo não ficaram como pedido.

`edit-types.ts` e `css-allowlist.ts` não foram criados: os tipos do patch ficam no próprio `source-patches.ts` e a lista de propriedades editáveis já existe em `preview/host-protocol.ts` (spec C 3.5 e ponte do design-service), sem cópia do Open Design. `zip.ts` não veio porque o export é feito no design-service.

## Regras

- O código do Open Design é lido só como dado, num clone em `/tmp` no commit acima, apagado ao fim. Nada dele roda na máquina de quem adapta.
- Nenhuma telemetria nem chamada de rede: o teste `__tests__/vendor-open-design.spec.ts` falha se algum arquivo desta pasta citar os serviços de telemetria do Open Design ou abrir conexão de rede pelo navegador.
- O protocolo com a prévia (`preview/host-protocol.ts`) é da Etus, escrito a partir da spec C 3.5 e espelhando o `protocol.ts` da ponte no design-service; não é cópia do Open Design.
- Todo arquivo adaptado mantém o aviso de modificação que a Apache-2.0 pede.
