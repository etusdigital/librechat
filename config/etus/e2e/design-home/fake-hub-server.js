const { startFakeHub } = require('./fake-hub');

startFakeHub({ port: Number(process.env.FAKE_HUB_PORT) }).then((hub) => {
  process.stdout.write(`fake hub listening at ${hub.url}\n`);
});
