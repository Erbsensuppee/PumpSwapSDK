const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
  createInitializeAccountInstruction,
  createAssociatedTokenAccountInstruction
} = require('@solana/spl-token');
const bs58 = require('bs58');
const path = require('path');
const { logger } = require('../src/logger.js')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });


const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([50, 132, 93, 181, 124, 20, 172, 218]);
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
//Pumpswap Authority
const GLOBAL_AUTHORITY = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
//Pumpfun Authority
//const GLOBAL_AUTHORITY = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const FEE_RECEIVER = new PublicKey('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV');
//const EVENT_AUTHORITY = new PublicKey('GokRjBCax9RjRThgCPxPRWmtuvFUMZhD63pGeJscV9Qw');
const EVENT_AUTHORITY = new PublicKey("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
const PRIVATE_KEY = process.env.PRIVATE_KEY_BASE58;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
//const secretKey = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const secretKey = bs58.decode(PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);
const connection = new Connection(RPC_ENDPOINT);

class PumpSwapSDK {
  constructor() {
    const secretKey = bs58.decode(PRIVATE_KEY);
    this.wallet = Keypair.fromSecretKey(secretKey);
    this.connection = new Connection(RPC_ENDPOINT);
  }
  async findPoolAddress(tokenMint, silent = false) {
    if (!silent) {
      console.log(`🔍 Searching for pool...`);
      console.log(`➡️  Token Mint: ${tokenMint.toBase58()}`);
      console.log(`➡️  WSOL Mint: ${WSOL_MINT.toBase58()}`);
      console.log(`➡️  Using program ID: ${PUMP_AMM_PROGRAM_ID.toBase58()}`);
    }
  
    const filters = [
      { dataSize: 211 },
      {
        memcmp: {
          offset: 43,
          bytes: tokenMint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: 75,
          bytes: WSOL_MINT.toBase58(),
        },
      },
    ];
  
    if (!silent) {
      console.log("🧪 Filters:");
      filters.forEach((f, i) => console.log(`  ${i + 1}:`, JSON.stringify(f)));
    }
  
    const accounts = await this.connection.getProgramAccounts(
      PUMP_AMM_PROGRAM_ID,
       { 
        commitment: "confirmed",
        filters 
      });
  
    if (accounts.length === 0) {
      if (!silent) {
        console.warn(`❌ No pool found for token mint: ${tokenMint.toBase58()}`);
      }
      throw new Error("Pool not found for token");
    }
  
    const found = accounts[0].pubkey.toBase58();
    if (!silent) {
      console.log(`✅ Pool found: ${found}`);
    }
  
    return accounts[0].pubkey;
  }
  

  async getReserves(pool, mint, silent = false) {
    if (!silent) {
      console.log("Getting reserves for pool:", pool.toBase58());
      console.log("Mint:", mint.toBase58());
      console.log("WSOL Mint:", WSOL_MINT.toBase58());
    }

    try {
      const tokenAcc = await getAssociatedTokenAddress(mint, pool, true);
      const wsolAcc = await getAssociatedTokenAddress(WSOL_MINT, pool, true);
  
      if (!silent) {
        console.log("Token account:", tokenAcc.toBase58());
        console.log("WSOL account:", wsolAcc.toBase58());
      }
  
      const [tokenBal, wsolBal] = await Promise.all([
        this.connection.getTokenAccountBalance(tokenAcc, "confirmed"),
        this.connection.getTokenAccountBalance(wsolAcc, "confirmed")
      ]);
      
      
  
      if (!silent) {
        console.log("Token balance:", tokenBal.value.amount);
        console.log("WSOL balance:", wsolBal.value.amount);
      }
  
      return {
        tokenReserve: BigInt(tokenBal.value.amount),
        solReserve: BigInt(wsolBal.value.amount)
      };
    } catch (e) {
      console.error("Error in getReserves:", e);
      throw e;
    }
  }
  

  async getTokenPriceInSol(tokenMint) {
    try {
      const mint = new PublicKey(tokenMint);
      const pool = await this.findPoolAddress(mint, true);
      const { tokenReserve, solReserve } = await this.getReserves(pool, mint, true);
  
      // Token-Decimals korrekt abrufen
      const mintInfo = await this.connection.getParsedAccountInfo(mint, "confirmed");
      const decimals = mintInfo.value?.data?.parsed?.info?.decimals || 9;
  
      // Reserves in echte Einheiten umrechnen
      const tokenAmount = Number(tokenReserve) / Math.pow(10, decimals);
      const solAmount = Number(solReserve) / 1e9;
  
      const price = solAmount / tokenAmount;
      return price;
    } catch (e) {
      console.error(`❌ Error getting price for ${tokenMint}:`, e);
      return null;
    }
  }
  
  async buildBuyTransaction(mint, userPubkey, solAmount, slippage = 0.03) {
    const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const pool = await this.findPoolAddress(mint);
    const { tokenReserve, solReserve } = await this.getReserves(pool, mint);
  
    const product = solReserve * tokenReserve;
    const newSolReserve = solReserve + solLamports;
    const newTokenReserve = product / newSolReserve;
    const tokenOut = tokenReserve - newTokenReserve;
  
    const slippageBps = BigInt(Math.floor(slippage * 10000));
    const maxSolSpend = solLamports * (10000n + slippageBps) / 10000n;
  
    const walletBalance = await this.connection.getBalance(this.wallet.publicKey, "confirmed");
    if (BigInt(walletBalance) < maxSolSpend) {
      throw new Error(`❌ Not enough SOL: Have ${walletBalance}, need ${maxSolSpend}`);
    }
  
    const userTokenATA = await getAssociatedTokenAddress(mint, userPubkey);
    const userWsolATA = await getAssociatedTokenAddress(WSOL_MINT, userPubkey);
    const poolBaseATA = await getAssociatedTokenAddress(mint, pool, true);
    const poolQuoteATA = await getAssociatedTokenAddress(WSOL_MINT, pool, true);
    const feeATA = await getAssociatedTokenAddress(WSOL_MINT, FEE_RECEIVER, true);
  
    const baseTokenProgram = TOKEN_PROGRAM_ID;
    const quoteTokenProgram = TOKEN_PROGRAM_ID;
  
    console.log("⚙️ Checking WSOL balance and preparing wrap if needed...");
    const wsolAccountInfo = await this.connection.getAccountInfo(userWsolATA);
    const wrapInstructions = [];
  
    if (!wsolAccountInfo) {
      // WSOL ATA doesn't exist, create it
      wrapInstructions.push(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          userWsolATA,
          userPubkey,
          WSOL_MINT
        )
      );
    }
  
    const wsolBalanceInfo = await this.connection
      .getTokenAccountBalance(userWsolATA, "confirmed")
      .catch(() => ({ value: { amount: "0" } }));
  
    const currentLamports = BigInt(wsolBalanceInfo.value.amount);
  
    if (currentLamports < maxSolSpend) {
      const wrapLamports = maxSolSpend - currentLamports;
      console.log(`🔁 Wrapping additional ${wrapLamports} lamports to WSOL`);
  
      wrapInstructions.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userWsolATA,
          lamports: Number(wrapLamports),
        }),
        createSyncNativeInstruction(userWsolATA)
      );
    }
  
    const buyIx = new TransactionInstruction({
      programId: PUMP_AMM_PROGRAM_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: false },
        { pubkey: userPubkey, isSigner: true, isWritable: true },
        { pubkey: GLOBAL_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
        { pubkey: userTokenATA, isSigner: false, isWritable: true },
        { pubkey: userWsolATA, isSigner: false, isWritable: true },
        { pubkey: poolBaseATA, isSigner: false, isWritable: true },
        { pubkey: poolQuoteATA, isSigner: false, isWritable: true },
        { pubkey: FEE_RECEIVER, isSigner: false, isWritable: false },
        { pubkey: feeATA, isSigner: false, isWritable: true },
        { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
        { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        BUY_DISCRIMINATOR,
        Buffer.alloc(8),
        Buffer.alloc(8),
      ]),
    });
  
    buyIx.data.writeBigUInt64LE(tokenOut, 8);
    buyIx.data.writeBigUInt64LE(maxSolSpend, 16);
  
    const instructions = [
      ...wrapInstructions,
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        userTokenATA,
        userPubkey,
        mint
      ),
      buyIx,
    ];
    
    // Only close WSOL account if we created it (optional step)
    if (!wsolAccountInfo) {
      instructions.push(
        createCloseAccountInstruction(userWsolATA, userPubkey, userPubkey)
      );
    }
    
    return instructions;    
  }

  async buildSellTransaction(mint, userPubkey, slippage = 0.03) {
    console.log("🛠️ Building SELL transaction for:", mint.toBase58());
  
    const userTokenATA = await getAssociatedTokenAddress(mint, userPubkey);
  
    // Check if token account exists
    const accountInfo = await this.connection.getAccountInfo(userTokenATA, "confirmed");
    if (!accountInfo) {
      throw new Error("❌ Token account does not exist. Nothing to sell.");
    }
  
    // Hole aktuelle Balance
    const parsedInfo = await this.connection.getParsedAccountInfo(userTokenATA, "confirmed");
    const tokenLamports = BigInt(parsedInfo.value?.data?.parsed?.info?.tokenAmount?.amount || 0);
  
    if (tokenLamports === 0n) {
      throw new Error("❌ Token account empty. Nothing to sell.");
    }
  
    const decimalsInfo = await this.connection.getParsedAccountInfo(mint, "confirmed");
    const decimals = decimalsInfo.value?.data?.parsed?.info?.decimals || 9;
    console.log("🔢 Token decimals:", decimals);
    console.log("💰 Token lamports to sell:", tokenLamports.toString());
  
    const pool = await this.findPoolAddress(mint);
    const { tokenReserve, solReserve } = await this.getReserves(pool, mint);
    console.log("🏦 Reserves - token:", tokenReserve.toString(), "SOL:", solReserve.toString());
  
    const product = solReserve * tokenReserve; 
    const newTokenReserve = tokenReserve + tokenLamports;
    const newSolReserve = product / newTokenReserve;
    const solOut = solReserve - newSolReserve;
    console.log("📉 Calculated SOL out:", solOut.toString());
  
    if (solOut <= 0n) {
      throw new Error("❌ Invalid expected SOL output. Possibly due to small token amount or low liquidity.");
    }
  
    const slippageBps = BigInt(Math.floor(slippage * 10000));
    const minSolOut = solOut * (10000n - slippageBps) / 10000n;
    console.log("📉 Minimum SOL out after slippage:", minSolOut.toString());
  
    // Resolve associated token accounts
    const userWsolATA = await getAssociatedTokenAddress(WSOL_MINT, userPubkey);
    const poolBaseATA = await getAssociatedTokenAddress(mint, pool, true);
    const poolQuoteATA = await getAssociatedTokenAddress(WSOL_MINT, pool, true);
    const feeATA = await getAssociatedTokenAddress(WSOL_MINT, FEE_RECEIVER, true);
  
    console.log("🔄 Resolved ATAs:");
    console.log("- userTokenATA:", userTokenATA.toBase58());
    console.log("- userWsolATA:", userWsolATA.toBase58());
    console.log("- poolBaseATA:", poolBaseATA.toBase58());
    console.log("- poolQuoteATA:", poolQuoteATA.toBase58());
    console.log("- feeATA:", feeATA.toBase58());
  
    const baseTokenProgram = TOKEN_PROGRAM_ID;
    const quoteTokenProgram = TOKEN_PROGRAM_ID;
  
    const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
    const data = Buffer.alloc(24);
    SELL_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(tokenLamports, 8);
    data.writeBigUInt64LE(minSolOut, 16);

    logger.info('Preparing TransferChecked', {
      tokenAccount: userTokenATA.toBase58(),
      tokenBalance: tokenLamports.toString(),
      decimals,
      expectedWSOL: userWsolATA.toBase58(),
    });
    
    console.log("📦 Instruction Data:", data.toString("hex"));
  
    const sellIx = new TransactionInstruction({
      programId: PUMP_AMM_PROGRAM_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: false },
        { pubkey: userPubkey, isSigner: true, isWritable: true },
        { pubkey: GLOBAL_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
        { pubkey: userTokenATA, isSigner: false, isWritable: true },
        { pubkey: userWsolATA, isSigner: false, isWritable: true },
        { pubkey: poolBaseATA, isSigner: false, isWritable: true },
        { pubkey: poolQuoteATA, isSigner: false, isWritable: true },
        { pubkey: FEE_RECEIVER, isSigner: false, isWritable: false },
        { pubkey: feeATA, isSigner: false, isWritable: true },
        { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
        { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
  
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        userPubkey,
        userWsolATA,
        userPubkey,
        WSOL_MINT
      ),
      sellIx,
      createCloseAccountInstruction(userWsolATA, userPubkey, userPubkey),
    ];
    
    return instructions;
    
  }
   
}

module.exports = { PumpSwapSDK };
