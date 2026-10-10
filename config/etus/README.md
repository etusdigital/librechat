# Scripts da Etus

Scripts de operação do fork. Rodam a partir da raiz do repositório, com o MongoDB configurado no `.env`.

## `seed-design-agent.js`

Cria ou atualiza o agente Etus Design a partir do JSON gerado pelo build do repositório `etus-design` (`agents/dist/etus-design.agent.json`).

```sh
node config/etus/seed-design-agent.js --file etus-design.agent.json --author-email <dono> [--dry-run] [--allow-missing] [--prune-tools]
node config/etus/seed-design-agent.js --remove --file etus-design.agent.json --author-email <dono> [--dry-run]
```

### Campos que o seed gerencia

A cada execução, estes campos voltam ao valor da definição. Mudá-los na tela do agente dura só até o próximo seed:

`name`, `description`, `instructions`, `provider`, `model`, `model_parameters`, `artifacts`, `skills` (pelos `skillNames`), `skills_enabled`, `skills_scope`, `skill_authoring_enabled`, `conversation_starters` e `category`.

### Campos que o seed soma

- `tools`: o seed **soma** as ferramentas da definição às que já estão no agente salvo, na ordem em que estavam, e acrescenta as que faltam no fim. Nunca remove uma ferramenta ligada na tela.
- `mcpServerNames`: os servidores do agente salvo são mantidos; `etus` entra quando há ferramenta do design.

### Campos que o seed não toca

Todo o resto do agente fica como a pessoa deixou na tela: arquivos e recursos das ferramentas (`tool_resources`), ações, `recursion_limit`, `end_after_tools`, `hide_sequential_outputs`, avatar e qualquer outro campo fora das listas acima.

### Ferramentas aceitas na definição

- Nativas do chat: `execute_code`, `web_search`, `file_search`, `image_gen_oai` e `ask_user_question`.
- Ferramentas do design pelo hub: `design__<nome>_mcp_etus`.

A definição é recusada se trouxer qualquer outra ferramenta: outro servidor MCP, outro app do hub, curingas (`sys__all__sys_mcp_etus`, `sys__server__sys_mcp_etus`), ações, `create_file`/`edit_file` ou nome repetido. Ferramentas de outros servidores que já estão no agente salvo continuam lá.

### Remover ferramentas: `--prune-tools`

Remoção só acontece com `--prune-tools`. Mesmo assim, só saem as ferramentas que o seed gerencia (as nativas acima e as `design__*_mcp_etus`) e que não estão na definição. Ferramentas de outros servidores ou ligadas na tela fora dessa lista ficam. Se nenhuma ferramenta do servidor `etus` sobrar, `etus` sai de `mcpServerNames`.

Rode antes com `--dry-run`: a saída mostra a diferença de cada campo e a linha `pruned tools` com o que sairia. Sem `--prune-tools`, o seed avisa quais ferramentas do agente não estão na definição.

## `check-upstream-touchpoints.js`

Confere que o fork só mexe no upstream onde é permitido (spec C, seção 3.1). Compara com o merge-base do upstream e falha se algum arquivo mudado ficar fora das pastas da Etus (`api/server/services/Etus/`, `api/server/routes/etus/`, `config/etus/`, `client/src/components/Design/`, `client/src/components/Etus/` e `client/src/locales/*/etus-design.json`) e da lista fechada de arquivos do upstream que está no próprio script.

```sh
node config/etus/check-upstream-touchpoints.js [--base <ref>] [--head <ref>]
```

Sem `--base`, usa `ETUS_UPSTREAM_REF` ou o primeiro que existir entre `upstream/main`, `origin/main` e `etus/main`. Sai com 0 quando está tudo dentro, 1 com a lista do que ficou fora e 2 quando não acha a referência. O teste `config/etus/__tests__/check-upstream-touchpoints.spec.js` roda a mesma conferência no repositório quando uma dessas referências existe (na CI, `npm run test:config`).

A lista tem duas partes: os quatro pontos do Design (`client/src/routes/index.tsx`, `client/src/hooks/Nav/useSideNavLinks.ts`, `client/src/locales/i18n.ts` e `api/server/index.js`) e os arquivos que patches anteriores da Etus já tocavam. Arquivo novo na lista só entra com a mudança de spec que o aprova.

## `e2e/design-home/`

E2e local da tela inicial do Design (pacote C4): cria um projeto pelo diálogo de novo projeto e confere a grade, a miniatura e o layout em 390x844 nos temas claro e escuro.

O teste sobe, cada um no seu processo: MongoDB num container Docker, um hub simulado (JWKS, troca de token de repasse e leituras de permissão), o design-service real do repositório `etus-design`, o proxy real `/api/etus/design` com uma sessão OpenID simulada e o LibreChat com o `client/dist`. O navegador usa a sessão local do LibreChat; as chamadas a `/api/etus/design/*` e `/preview/*` são repassadas ao proxy e à prévia do design-service, porque o LibreChat local não tem id token do Logto.

```sh
npm run build:packages && npm run build:client
(cd ../etus-design && pnpm install --frozen-lockfile)
ETUS_DESIGN_DIR=../etus-design npx playwright test -c config/etus/e2e/design-home/playwright.config.js
```

As capturas ficam em `$TMPDIR/etus-design-home-e2e-screens` (ou em `E2E_SCREENSHOT_DIR`) e os logs de cada processo numa pasta temporária indicada ao fim da execução.

## `e2e/chat/`

E2e local do chat embutido na tela do projeto (pacote C6). Roda o LibreChat real com o build de produção do client, um modelo falso compatível com a API da OpenAI e o agente Etus Design semeado sem ferramentas. O design-service é simulado pelo Playwright em `/api/etus/design/*` (com o vínculo `POST /projects/:id/conversations` e a consulta `GET /conversations/:id/project`) e a prévia em `/preview/*`.

Confere: a primeira mensagem chega ao modelo com a linha `[Projeto Etus Design]: <projectId>` e o pedido do diálogo de novo projeto, a linha não aparece na conversa, a URL da tela não muda, a conversa é vinculada ao projeto depois da primeira resposta, "Novo chat" e o seletor de modelo ficam escondidos, as 3 sugestões aparecem e clicar envia o texto (C-10), a consulta de mudanças acelera durante a resposta, reabrir o projeto retoma a conversa e põe o pedido da galeria no composer sem apagar o rascunho, e o layout em 390x844.

```sh
docker run -d --rm --name c6-e2e-mongo -p 127.0.0.1:27186:27017 mongo:8.0
npm run build:packages && npm run build:client
```

`.env` local (fora do git) com `PORT=3186`, `MONGO_URI=mongodb://127.0.0.1:27186/LibreChatC6`, `DOMAIN_CLIENT` e `DOMAIN_SERVER` em `http://localhost:3186`, `ALLOW_EMAIL_LOGIN=true`, `ALLOW_REGISTRATION=true`, `SEARCH=false`, `FAKE_LLM_KEY=local-fake`, `CONFIG_PATH` apontando para `config/etus/e2e/chat/librechat.e2e.yaml` e `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET` e `JWT_REFRESH_SECRET` gerados com `openssl rand -hex`.

```sh
node config/etus/e2e/chat/fake-llm.mjs &
NODE_ENV=production node api/server/index.js &
node config/etus/e2e/chat/chat.mjs register
node config/etus/seed-design-agent.js --file config/etus/e2e/chat/agent.json --author-email designer.c6@example.com
node config/etus/e2e/chat/chat.mjs
```

O modelo falso guarda os pedidos em memória (`GET /__requests`); reinicie-o antes de cada execução. As capturas ficam em `C6_SCREENSHOTS`, quando definido.

## `e2e/inspect/`

E2e local da edição direta na prévia (pacote C8, critério C-4): no modo **Editar**, troca o texto e a cor de um título, salva e confere o HTML gravado (com `If-Match` e `X-Etus-Version-Source: inline_edit`); depois simula o agente gravando no meio da edição e confere as duas saídas do conflito (**Aplicar de novo sobre a versão nova** e **Recarregar**), além do painel em 390x844 nos temas claro e escuro, com axe.

Usa o LibreChat real com o `client/dist` e login local; o design-service é simulado pelo Playwright em `/api/etus/design/*` (com a regra de `If-Match` do serviço) e a prévia em `/preview/*` sai com a CSP `sandbox` e o `bridge.js` real do `etus-design`.

```sh
npm run build:packages && (cd client && NODE_ENV=production ../node_modules/.bin/vite build)
NODE_ENV=production node api/server/index.js   # .env local com PORT=3188 e MONGO_URI de um MongoDB em Docker
node config/etus/e2e/inspect/inspect.mjs register
ETUS_DESIGN_BRIDGE_JS=../etus-design/design-service/src/preview/bridge/bridge.js node config/etus/e2e/inspect/inspect.mjs
```

`C8_BASE_URL` troca o endereço do LibreChat e `C8_SCREENSHOTS` guarda as capturas numa pasta.

## `e2e/draw/`

E2e local do modo Desenhar (pacote C9). Usa o mesmo LibreChat de produção, o modelo falso e o agente do `e2e/chat/`, com o modelo falso em outra porta (`librechat.e2e.yaml` desta pasta aponta para `127.0.0.1:4809`). O design-service e o renderer são simulados pelo Playwright: `POST /projects/:id/screenshots` devolve um job `queued`, `GET /jobs/:id` passa por `running` e termina em `succeeded` na segunda consulta, e `/preview/d/*` entrega um PNG de 1170x2532 (celular com escala 3) gerado pelo próprio Chromium. A prévia usa o `bridge.js` real do repositório `etus-design`, para o `etus:ready` chegar.

Confere: entrar em Desenhar recarrega a prévia rolada e ela volta ao topo; o canvas cobre o dispositivo no zoom atual; desenhar, trocar cor e desfazer; o pedido de screenshot com o dispositivo atual e sem página inteira; a espera do job; o download sem cookie; o composer com o texto escrito e a linha "Veja as marcações na imagem e ajuste o arquivo index.html."; o upload pelo LibreChat; o modelo recebendo o texto e uma imagem, com a marcação azul no lugar desenhado e a captura em volta; em 390x844, no tema escuro, sem rolagem horizontal e com a aba Chat aberta depois de anexar.

```sh
docker run -d --rm --name c9-e2e-mongo -p 127.0.0.1:27189:27017 mongo:8.0
npm run build:packages && npm run build:client
```

`.env` local como o do `e2e/chat/`, com `PORT=3189`, `MONGO_URI=mongodb://127.0.0.1:27189/LibreChatC9`, `DOMAIN_CLIENT` e `DOMAIN_SERVER` em `http://localhost:3189` e `CONFIG_PATH` apontando para `config/etus/e2e/draw/librechat.e2e.yaml`.

```sh
FAKE_LLM_PORT=4809 node config/etus/e2e/chat/fake-llm.mjs &
NODE_ENV=production node api/server/index.js &
node config/etus/e2e/draw/draw.mjs register
node config/etus/seed-design-agent.js --file config/etus/e2e/chat/agent.json --author-email designer.c9@example.com
ETUS_DESIGN_BRIDGE_JS=../etus-design/design-service/src/preview/bridge/bridge.js node config/etus/e2e/draw/draw.mjs
```

O modelo falso também guarda as imagens recebidas (`GET /__images`). As capturas ficam em `C9_SCREENSHOTS`, quando definido.

## `e2e/comments/`

E2e local dos comentários na prévia (pacote C7, critério C-5). Usa o mesmo modelo falso e o mesmo agente do `e2e/chat/`, com o modelo na porta 4801 (`librechat.e2e.yaml` desta pasta). O design-service é simulado pelo Playwright em `/api/etus/design/*`, com os comentários (`GET` e `POST /projects/:id/comments`, `PATCH /comments/:id`) guardados em memória, e a prévia em `/preview/*` recebe o `bridge.js` real do repositório `etus-design`.

Confere: clique real num elemento da prévia abre a caixa do comentário logo abaixo dele; com Ajustar, a caixa fica no tamanho normal e dentro da prévia; dois comentários gravados com seletor, trecho, versão e dispositivo; **Enviar ao chat** põe no composer o texto no formato de C 3.7 sem enviar e marca os comentários como enviados; ao enviar, o agente simulado recebe o pedido; os comentários resolvidos pelo agente aparecem em Resolvidos com a nota; reabrir; clicar num comentário realça o elemento; e, em 390x844 nos temas claro e escuro, comentar sem rolagem horizontal e voltar para a aba Chat com o pedido no composer.

```sh
docker run -d --rm --name c7-e2e-mongo -p 127.0.0.1:27187:27017 mongo:8.0
npm run build:packages && npm run build:client
```

`.env` local (fora do git) como o do `e2e/chat/`, com `PORT=3187`, `MONGO_URI=mongodb://127.0.0.1:27187/LibreChatC7`, `DOMAIN_CLIENT` e `DOMAIN_SERVER` em `http://localhost:3187` `CONFIG_PATH` apontando para `config/etus/e2e/comments/librechat.e2e.yaml` e `LOGIN_MAX=100` (cada execução entra 3 vezes, e o limite padrão de 7 entradas em 5 minutos derruba a segunda execução seguida).

```sh
FAKE_LLM_PORT=4801 node config/etus/e2e/chat/fake-llm.mjs &
NODE_ENV=production node api/server/index.js &
node config/etus/e2e/comments/comments.mjs register
node config/etus/seed-design-agent.js --file config/etus/e2e/chat/agent.json --author-email designer.c7@example.com
ETUS_DESIGN_BRIDGE_JS=../etus-design/design-service/src/preview/bridge/bridge.js node config/etus/e2e/comments/comments.mjs
```

O erro `Failed to read the 'serviceWorker' property` que aparece no log vem do `serviceWorkers: 'block'` do Playwright dentro do iframe sandbox da prévia, não da tela. O desktop roda em 1600x900: em 1280x800, com a barra lateral do LibreChat aberta e o painel de comentários, a área da prévia fica com cerca de 160 px e o Playwright não alcança o elemento (o clique cai no painel). As capturas ficam em `C7_SCREENSHOTS`, quando definido.
