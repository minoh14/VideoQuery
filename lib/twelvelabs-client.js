const { TwelvelabsApiClient } = require('twelvelabs-js');

function createClient(apiKey) {
  return new TwelvelabsApiClient({ apiKey });
}

module.exports = { createClient };
