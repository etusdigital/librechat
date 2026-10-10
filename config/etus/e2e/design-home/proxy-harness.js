const express = require('express');

const PERSON = {
  id: 'e2e-chat-user',
  sub: 'logto-e2e-ana',
  email: 'ana@etus.test',
  name: 'Ana E2E',
};

function unsignedIdToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'none' })}.${encode({ sub: PERSON.sub, email: PERSON.email, name: PERSON.name, exp })}.e2e`;
}

function simulatedOpenIdSession(req, _res, next) {
  req.user = {
    id: PERSON.id,
    provider: 'openid',
    openidId: PERSON.sub,
    email: PERSON.email,
    name: PERSON.name,
    federatedTokens: { id_token: unsignedIdToken() },
  };
  next();
}

const { designProxy } = require('../../../../api/server/services/Etus/design/proxy');

const app = express();
app.use('/api/etus/design', simulatedOpenIdSession, designProxy);

const port = Number(process.env.PROXY_HARNESS_PORT);
app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`design proxy harness listening on ${port}\n`);
});
