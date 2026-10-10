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
