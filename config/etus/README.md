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
