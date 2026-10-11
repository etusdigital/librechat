export const landingPage = (heading = 'Landing Produto X') => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Landing</title>
    <style>
      body { font-family: sans-serif; margin: 0; color: #111827; background: #ffffff; }
      header, section, footer { padding: 24px; }
      .hero h1 { color: #0f172a; font-size: 40px; margin: 0 0 12px; }
      .cta { background: #3be476; color: #0b0b0b; padding: 12px 20px; border-radius: 8px; display: inline-block; }
      .left-edge { position: absolute; left: 0; top: 0; width: 40px; height: 40px; background: #ef4444; }
    </style>
  </head>
  <body>
    <div class="left-edge" id="left-edge"></div>
    <header><strong>Produto X</strong></header>
    <section class="hero">
      <h1>${heading}</h1>
      <p id="lead">Software simples para pequenas empresas.</p>
      <a class="cta" id="cta" href="#precos">Começar agora</a>
    </section>
    <section id="precos"><h2>Preços</h2><p>Planos a partir de R$ 49.</p></section>
    <footer><a href="#">Sobre</a> <a href="#">Contato</a></footer>
    <p id="vw"></p>
    <script>document.getElementById('vw').textContent = innerWidth + 'x' + innerHeight;</script>
  </body>
</html>
`;

export const lowContrastPage = () => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Landing com contraste ruim</title>
    <style>
      body { font-family: sans-serif; margin: 0; color: #111827; background: #ffffff; }
      section { padding: 24px; }
      .hero h1 { font-size: 36px; margin: 0 0 12px; }
      .hero a.cta { background: #3be476; color: #ffffff; padding: 12px 20px; border-radius: 8px; display: inline-block; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Solução completa</h1>
        <p>Software simples para pequenas empresas.</p>
        <a class="cta" href="#precos">Começar agora</a>
      </section>
      <section id="precos"><h2>Preços</h2><p>Planos a partir de R$ 49.</p></section>
    </main>
  </body>
</html>
`;
