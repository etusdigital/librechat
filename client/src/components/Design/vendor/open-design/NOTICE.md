# Código adaptado do Open Design

Esta pasta guarda o código da tela Design que vem do Open Design (https://github.com/nexu-io/open-design), licenciado sob a Apache-2.0 (cópia em `LICENSE`).

| Item                  | Valor                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Repositório de origem | https://github.com/nexu-io/open-design                                                                           |
| Commit                | `802708f6c9f294347ef777b1fda49b9cbe26ef72` (o mesmo de `design-assets/config/upstream.lock.json` no etus-design) |
| Licença               | Apache-2.0                                                                                                       |

## O que veio

| Arquivo aqui | Origem    | O que mudou        |
| ------------ | --------- | ------------------ |
| `LICENSE`    | `LICENSE` | nada (cópia exata) |

Os arquivos adaptados do edit-mode do Open Design (`source-patches.ts`, `edit-types.ts`, `css-allowlist.ts` e, se o export no navegador for usado, `zip.ts`) entram com o pacote da edição inline (C8). Cada arquivo novo entra nesta tabela e no `SOURCES.json`, com o caminho de origem, o commit e o sha256 do arquivo daqui.

## Regras

- O código do Open Design é lido só como dado, num clone em `/tmp` no commit acima, apagado ao fim. Nada dele roda na máquina de quem adapta.
- Nenhuma telemetria nem chamada de rede: o teste `__tests__/vendor-open-design.spec.ts` falha se algum arquivo desta pasta citar os serviços de telemetria do Open Design ou abrir conexão de rede pelo navegador.
- O protocolo com a prévia (`preview/host-protocol.ts`) é da Etus, escrito a partir da spec C 3.5 e espelhando o `protocol.ts` da ponte no design-service; não é cópia do Open Design.
- Todo arquivo adaptado mantém o aviso de modificação que a Apache-2.0 pede.
