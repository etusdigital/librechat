import type { SourcePatch } from '../vendor/open-design/source-patches';
import {
  applySourcePatches,
  normalizeSnippet,
  readSourceElement,
} from '../vendor/open-design/source-patches';

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Landing</title>
  <style>h1 { color: var(--fg); }</style>
</head>
<body>
  <!-- <h1>commented heading</h1> -->
  <main>
    <section class="hero">
      <h1>
        Landing Produto X
      </h1>
      <p class="lead" style='font-weight: 600; color: #111'>Caf&eacute; &amp; c&oacute;digo</p>
      <a href="#precos" title="a > b">Ver preços</a>
    </section>
    <section>
      <p>Primeiro <strong>forte</strong> texto</p>
      <button id="cta" style="padding: 8px; margin-top: 2px">Começar</button>
    </section>
  </main>
  <script>document.write('<h1>from script</h1>');</script>
</body>
</html>
`;

const H1 = 'body > main:nth-of-type(1) > section:nth-of-type(1) > h1:nth-of-type(1)';
const LEAD = 'body > main:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(1)';
const LINK = 'body > main:nth-of-type(1) > section:nth-of-type(1) > a:nth-of-type(1)';
const MIXED = 'body > main:nth-of-type(1) > section:nth-of-type(2) > p:nth-of-type(1)';

function apply(patches: SourcePatch[], source = PAGE) {
  const result = applySourcePatches(source, patches);
  if (!result.ok) {
    throw new Error(`patch failed: ${result.error} ${result.selector ?? ''}`);
  }
  return result.source;
}

function changedLines(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b).toHaveLength(a.length);
  return b.flatMap((line, index) => (line === a[index] ? [] : [line]));
}

function parse(source: string) {
  return new DOMParser().parseFromString(source, 'text/html');
}

function bridgeSelector(element: Element) {
  const parts: string[] = [];
  let node: Element | null = element;
  const body = element.ownerDocument.body;
  while (node && node !== body) {
    const id = node.getAttribute('id');
    if (id && element.ownerDocument.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(id)}`);
      return parts.join(' > ');
    }
    let index = 1;
    for (
      let sibling = node.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === node.tagName) {
        index += 1;
      }
    }
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    node = node.parentElement;
  }
  return `body > ${parts.join(' > ')}`;
}

describe('source patches', () => {
  it('changes only the text of the element and keeps its indentation', () => {
    const after = apply([{ selector: H1, text: 'Landing nova' }]);
    expect(changedLines(PAGE, after)).toEqual(['        Landing nova']);
    expect(parse(after).querySelector(H1)?.textContent?.trim()).toBe('Landing nova');
  });

  it('writes a style attribute where there was none', () => {
    const after = apply([{ selector: H1, styles: { color: '#3be476', 'font-size': '48px' } }]);
    expect(changedLines(PAGE, after)).toEqual([
      '      <h1 style="color: #3be476; font-size: 48px">',
    ]);
  });

  it('updates an existing style and keeps the other declarations', () => {
    const after = apply([
      {
        selector: '#cta',
        styles: { padding: '12px 16px', 'background-color': 'var(--accent, #3be476)' },
      },
    ]);
    expect(changedLines(PAGE, after)).toEqual([
      '      <button id="cta" style="margin-top: 2px; padding: 12px 16px; background-color: var(--accent, #3be476)">Começar</button>',
    ]);
  });

  it('drops longhands when a shorthand is set, like the live preview does', () => {
    const after = apply([{ selector: '#cta', styles: { margin: '0' } }]);
    expect(parse(after).querySelector('#cta')?.getAttribute('style')).toBe(
      'padding: 8px; margin: 0',
    );
  });

  it('removes a property with an empty value and the attribute when nothing is left', () => {
    const after = apply([{ selector: '#cta', styles: { padding: '', 'margin-top': '' } }]);
    expect(changedLines(PAGE, after)).toEqual(['      <button id="cta">Começar</button>']);
  });

  it('rewrites single quoted styles with escaped double quotes', () => {
    const after = apply([{ selector: LEAD, styles: { color: 'var(--fg, "x")' } }]);
    expect(changedLines(PAGE, after)).toEqual([
      '      <p class="lead" style="font-weight: 600; color: var(--fg, &quot;x&quot;)">Caf&eacute; &amp; c&oacute;digo</p>',
    ]);
    expect(parse(after).querySelector(LEAD)?.getAttribute('style')).toBe(
      'font-weight: 600; color: var(--fg, "x")',
    );
  });

  it('edits text with entities and an attribute value that contains >', () => {
    const after = apply([
      { selector: LEAD, text: 'Café & código' },
      { selector: LINK, text: 'Ver planos' },
    ]);
    expect(changedLines(PAGE, after)).toEqual([
      '      <p class="lead" style=\'font-weight: 600; color: #111\'>Café &amp; código</p>',
      '      <a href="#precos" title="a > b">Ver planos</a>',
    ]);
  });

  it('escapes markup typed as text, so text never becomes HTML', () => {
    const after = apply([
      { selector: H1, text: '<img src=x onerror=alert(1)><script>alert(2)</script>' },
    ]);
    const doc = parse(after);
    expect(doc.querySelector(H1)?.children).toHaveLength(0);
    expect(doc.querySelector(H1)?.textContent?.trim()).toBe(
      '<img src=x onerror=alert(1)><script>alert(2)</script>',
    );
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(after).toContain('&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;');
  });

  it('applies several patches at once and merges patches of the same element', () => {
    const after = apply([
      { selector: H1, text: 'A' },
      { selector: H1, styles: { color: 'red' } },
      { selector: '#cta', text: 'Assinar' },
    ]);
    const doc = parse(after);
    expect(doc.querySelector(H1)?.textContent?.trim()).toBe('A');
    expect(doc.querySelector(H1)?.getAttribute('style')).toBe('color: red');
    expect(doc.querySelector('#cta')?.textContent).toBe('Assinar');
  });

  it('ignores tags inside comments, scripts and attribute values when mapping the source', () => {
    const doc = parse(PAGE);
    const h1 = doc.querySelector('h1');
    expect(h1 && bridgeSelector(h1)).toBe(H1);
    const after = apply([{ selector: H1, styles: { color: 'blue' } }]);
    expect(after).toContain('<!-- <h1>commented heading</h1> -->');
    expect(after).toContain("document.write('<h1>from script</h1>');");
  });

  it('works with fragments, implied elements and upper case markup', () => {
    const fragment = '<TABLE><TR><TD STYLE="Color: red">Preço</TD></TR></TABLE>';
    const cell = parse(fragment).querySelector('td') as Element;
    const selector = bridgeSelector(cell);
    expect(selector).toBe(
      'body > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(1) > td:nth-of-type(1)',
    );
    expect(apply([{ selector, text: 'Valor', styles: { color: 'blue' } }], fragment)).toBe(
      '<TABLE><TR><TD style="color: blue">Valor</TD></TR></TABLE>',
    );
  });

  it('refuses text on elements with nested markup and on whitespace sensitive pre', () => {
    expect(applySourcePatches(PAGE, [{ selector: MIXED, text: 'x' }])).toEqual({
      ok: false,
      error: 'text_not_editable',
      selector: MIXED,
    });
    const pre = '<pre>\nline</pre>';
    expect(
      applySourcePatches(pre, [{ selector: 'body > pre:nth-of-type(1)', text: 'x' }]),
    ).toMatchObject({
      ok: false,
      error: 'text_not_editable',
    });
  });

  it('refuses elements created by scripts or cloned by the parser', () => {
    expect(
      applySourcePatches(PAGE, [{ selector: 'body > h1:nth-of-type(1)', text: 'x' }]),
    ).toMatchObject({
      ok: false,
      error: 'target_not_found',
    });
    const misnested = '<p><b>one</p><p>two</b></p>';
    const clone = 'body > p:nth-of-type(2) > b:nth-of-type(1)';
    expect(parse(misnested).querySelector(clone)).not.toBeNull();
    expect(
      applySourcePatches(misnested, [{ selector: clone, styles: { color: 'red' } }]),
    ).toMatchObject({
      ok: false,
      error: 'target_not_in_source',
    });
  });

  it('refuses a patch when the element no longer has the text it had', () => {
    expect(
      applySourcePatches(PAGE, [
        { selector: H1, expectedText: 'Outro título', styles: { color: 'red' } },
      ]),
    ).toMatchObject({ ok: false, error: 'target_changed' });
    expect(
      applySourcePatches(PAGE, [
        { selector: H1, expectedText: '  Landing   Produto X ', styles: { color: 'red' } },
      ]).ok,
    ).toBe(true);
  });

  describe('malicious input from the preview', () => {
    it.each([
      ['an invalid selector', ']]>[<'],
      ['an empty selector', ''],
      ['a selector longer than the limit', `body > ${'div > '.repeat(300)}p`],
    ])('rejects %s', (_label, selector) => {
      expect(applySourcePatches(PAGE, [{ selector, styles: { color: 'red' } }]).ok).toBe(false);
    });

    it.each([
      ['every element', '*', 'target_ambiguous'],
      ['the body', 'body', 'target_not_found'],
      ['the html element', 'html', 'target_not_found'],
      ['the head title', 'head > title', 'target_not_found'],
      ['a script', 'script', 'target_not_found'],
      ['a style element', 'style', 'target_not_found'],
      ['the source marker', '[data-etus-src]', 'target_ambiguous'],
    ])('does not touch %s', (_label, selector, error) => {
      expect(applySourcePatches(PAGE, [{ selector, text: 'pwned' }])).toMatchObject({
        ok: false,
        error,
      });
    });

    it.each([
      ['a url()', { 'background-color': 'url(https://evil.test/x)' }],
      ['an expression()', { color: 'expression(alert(1))' }],
      ['javascript:', { color: 'javascript:alert(1)' }],
      ['a declaration break', { color: 'red; position: fixed' }],
      ['a rule break', { color: 'red} body{display:none' }],
      ['markup', { color: '"><script>alert(1)</script>' }],
      ['an escape', { color: '\\75 rl(x)' }],
      ['an @import', { color: '@import "x"' }],
      ['a property outside the list', { position: 'fixed' }],
      ['an event handler as property', { onclick: 'alert(1)' }],
      ['a value over the size limit', { color: 'a'.repeat(201) }],
    ])('rejects styles with %s', (_label, styles) => {
      expect(applySourcePatches(PAGE, [{ selector: H1, styles }])).toMatchObject({
        ok: false,
        error: 'invalid_patch',
      });
    });

    it('rejects oversized text and empty patches', () => {
      expect(applySourcePatches(PAGE, [{ selector: H1, text: 'x'.repeat(10_001) }]).ok).toBe(false);
      expect(applySourcePatches(PAGE, [{ selector: H1 }]).ok).toBe(false);
      expect(applySourcePatches(PAGE, [{ selector: H1, text: 1 as unknown as string }]).ok).toBe(
        false,
      );
    });

    it('keeps attribute quoting safe for quotes and ampersands in values', () => {
      const after = apply([{ selector: H1, styles: { color: 'var(--x, "a&b")' } }]);
      const doc = parse(after);
      expect(doc.querySelector(H1)?.getAttributeNames()).toEqual(['style']);
      expect(doc.querySelector(H1)?.getAttribute('style')).toBe('color: var(--x, "a&b")');
    });

    it('never changes the document structure', () => {
      const before = Array.from(parse(PAGE).getElementsByTagName('*')).map((el) => el.tagName);
      const after = apply([
        { selector: H1, text: '</h1><h2>injected</h2><h1>' },
        { selector: '#cta', text: '<!-- x -->' },
      ]);
      expect(Array.from(parse(after).getElementsByTagName('*')).map((el) => el.tagName)).toEqual(
        before,
      );
    });
  });

  describe('readSourceElement', () => {
    it('reads text, inline styles and whether the text can be edited', () => {
      expect(readSourceElement(PAGE, LEAD)).toEqual({
        ok: true,
        element: {
          tag: 'p',
          text: 'Café & código',
          snippet: 'Café & código',
          textEditable: true,
          styles: { 'font-weight': '600', color: '#111' },
        },
      });
      expect(readSourceElement(PAGE, MIXED)).toMatchObject({
        ok: true,
        element: { textEditable: false, snippet: 'Primeiro forte texto' },
      });
      expect(readSourceElement(PAGE, H1)).toMatchObject({
        ok: true,
        element: { text: 'Landing Produto X', snippet: 'Landing Produto X' },
      });
    });

    it('reports elements that are not in the source', () => {
      expect(readSourceElement(PAGE, 'body > h1:nth-of-type(1)')).toEqual({
        ok: false,
        error: 'target_not_found',
      });
      expect(readSourceElement(PAGE, '')).toEqual({ ok: false, error: 'invalid_patch' });
    });
  });

  it('normalizes snippets like the bridge', () => {
    expect(normalizeSnippet('  a\n\t b  ')).toBe('a b');
    expect(normalizeSnippet('x'.repeat(300))).toHaveLength(200);
  });
});
