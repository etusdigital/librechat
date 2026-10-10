import { Tools } from 'librechat-data-provider';
import { formatToolContent } from '~/mcp/parsers';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('M0 spike B 9.4: how a design-service result reaches the chat', () => {
  const result = {
    content: [
      { type: 'text', text: 'Rendered index.html on mobile.' },
      { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
      {
        type: 'resource',
        resource: {
          uri: 'ui://etus-design/project-card',
          mimeType: 'text/html',
          text: '<div><a href="https://preview.example/p/abc" target="_blank">Abrir preview</a></div>',
        },
      },
    ],
  };

  it('custom endpoints run as openai, so images become image_url artifacts and ui:// becomes a marker', () => {
    const [text, artifacts] = formatToolContent(result as never, 'openai' as never);

    expect(text).toContain('Rendered index.html on mobile.');
    expect(text).toMatch(/UI Resource Marker: \\ui\{[a-z0-9]+\}/);
    expect(artifacts?.content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
    ]);
    const uiResources = (artifacts as Record<string, { data: unknown[] }>)[Tools.ui_resources].data;
    expect(uiResources).toHaveLength(1);
    expect(uiResources[0]).toMatchObject({
      uri: 'ui://etus-design/project-card',
      mimeType: 'text/html',
    });
  });

  it('an unrecognized provider flattens everything into text', () => {
    const [text, artifacts] = formatToolContent(result as never, 'ETUS AI' as never);
    expect(artifacts).toBeUndefined();
    expect(typeof text).toBe('string');
  });
});
