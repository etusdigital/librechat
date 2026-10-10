import { draftInsertion, projectFirstMessage, projectLinkLine } from '../chat/project-link';
import { parseNextSteps } from '../workspace/next-steps/parse-next-steps';

const reply = (section: string) => `Fiz a landing com hero, preços e depoimentos.\n\n${section}`;

describe('parseNextSteps', () => {
  it('reads the three items after a markdown heading', () => {
    expect(
      parseNextSteps(
        reply(
          '## Próximos passos\n\n1. Adicionar seção de FAQ\n2. Trocar a cor do botão principal\n3. Exportar em PDF',
        ),
      ),
    ).toEqual(['Adicionar seção de FAQ', 'Trocar a cor do botão principal', 'Exportar em PDF']);
  });

  it('accepts a bold heading with a colon, bullets and loose lists', () => {
    expect(
      parseNextSteps(
        reply(
          '**Próximos passos:**\n\n- **Adicione uma seção de depoimentos**\n\n* "Exporte o deck em PDF"\n+ Ajuste o rodapé',
        ),
      ),
    ).toEqual(['Adicione uma seção de depoimentos', 'Exporte o deck em PDF', 'Ajuste o rodapé']);
  });

  it('uses the last section of the reply', () => {
    const text = [
      '### Proximos passos',
      '- velho 1',
      '- velho 2',
      '- velho 3',
      '',
      'Mais texto.',
      '',
      '### Próximos passos',
      '1) novo 1',
      '2) novo 2',
      '3) novo 3',
    ].join('\r\n');
    expect(parseNextSteps(text)).toEqual(['novo 1', 'novo 2', 'novo 3']);
  });

  it('shows nothing when the format does not match', () => {
    expect(parseNextSteps(null)).toEqual([]);
    expect(parseNextSteps('Olá! Como posso ajudar?')).toEqual([]);
    expect(parseNextSteps(reply('## Próximos passos\n\n- um\n- dois'))).toEqual([]);
    expect(parseNextSteps(reply('## Próximos passos\n\n- um\n- dois\n- três\n- quatro'))).toEqual(
      [],
    );
    expect(parseNextSteps(reply('## Próximos passos\n\nFaça isto e aquilo.'))).toEqual([]);
    expect(parseNextSteps(reply('Os próximos passos são:\n- um\n- dois\n- três'))).toEqual([]);
  });

  it('stops at the first line that is not a list item', () => {
    expect(
      parseNextSteps(reply('## Próximos passos\n- um\n- dois\n- três\nQualquer dúvida, me chame.')),
    ).toEqual(['um', 'dois', 'três']);
  });
});

describe('project link', () => {
  it('starts the first message with the hidden link definition and the brief', () => {
    expect(projectLinkLine('prj_abc')).toBe('[Projeto Etus Design]: prj_abc');
    expect(projectFirstMessage('prj_abc', '  landing com preços ')).toBe(
      '[Projeto Etus Design]: prj_abc\n\nlanding com preços',
    );
  });

  it('separates inserted text from a draft without replacing it', () => {
    expect(draftInsertion('', 'Aplique o design system Etus')).toBe('Aplique o design system Etus');
    expect(draftInsertion('meu rascunho', 'Texto')).toBe('\n\nTexto');
    expect(draftInsertion('meu rascunho\n', 'Texto')).toBe('\nTexto');
    expect(draftInsertion('meu rascunho\n\n', 'Texto')).toBe('Texto');
  });
});
