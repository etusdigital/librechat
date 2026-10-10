const { stopStack } = require('./stack');

module.exports = async function globalTeardown() {
  stopStack();
};
