const { startStack, stopStack } = require('./stack');

module.exports = async function globalSetup() {
  try {
    await startStack();
  } catch (error) {
    stopStack();
    throw error;
  }
};
