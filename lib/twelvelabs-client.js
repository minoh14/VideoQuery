const { TwelvelabsApiClient } = require('twelvelabs-js');

const client = new TwelvelabsApiClient({ apiKey: process.env.TWELVELABS_API_KEY });

module.exports = client;
