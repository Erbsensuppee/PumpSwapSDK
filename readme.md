# PumpSwapSDK

A minimal SDK to interact with Pump.fun's AMM on the Solana blockchain.  
Use it to build `BUY` and `SELL` transaction instructions for any Pump.fun-listed token.

---

## Features

- 🔍 Find Pump.fun token pool addresses
- 💰 Fetch token reserves and SOL price
- 🛠 Build `BUY` and `SELL` transaction instructions
- 🔄 Auto-wrap SOL to WSOL
- ⚙️ Slippage support

---

## Installation

Install the required dependencies:

```bash
npm install @solana/web3.js @solana/spl-token bs58 dotenv
