const { PumpSwapSDK } = require('./pumpSwapSDK');
const { Keypair, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');

// Load from env
require('dotenv').config();
const PRIVATE_KEY = process.env.PRIVATE_KEY_BASE58;

const sdk = new PumpSwapSDK();
const user = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

(async () => {
  const mint = new PublicKey("YOUR_TOKEN_MINT_HERE");
  const buyInstructions = await sdk.buildBuyTransaction(mint, user.publicKey, 0.001);
  const sellInstructions = await sdk.buildSellTransaction(mint, user.publicKey);
})();
