#!/usr/bin/env node
/**
 * SolRouter Private Portfolio Risk Analyzer
 *
 * Analyzes a Solana wallet's DeFi portfolio using end-to-end encrypted
 * AI inference via SolRouter — the AI provider never sees your wallet address
 * or portfolio composition.
 */

import { SolRouter } from '@solrouter/sdk';
import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.SOLROUTER_API_KEY;
if (!API_KEY) {
  console.error('❌ SOLROUTER_API_KEY not set. See .env.example');
  process.exit(1);
}

const client = new SolRouter({ apiKey: API_KEY });

// ─── Solana RPC ──────────────────────────────────────────────────────────────
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const FETCH_TIMEOUT = 15_000;

interface TokenHolding {
  mint: string;
  symbol: string;
  amount: number;
  usdValue: number;
}

interface PortfolioData {
  walletAddress: string;
  solBalance: number;
  solUsdValue: number;
  tokens: TokenHolding[];
  totalUsdValue: number;
}

interface TokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } };
}

// ─── Solana JSON-RPC helper ───────────────────────────────────────────────────
async function rpcCall(method: string, params: unknown[]): Promise<Record<string, unknown>> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP error (${method}): ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  if (data.error) throw new Error(`RPC error (${method}): ${JSON.stringify(data.error)}`);
  return data;
}

// ─── Fetch portfolio data from Solana RPC ────────────────────────────────────
async function fetchPortfolio(walletAddress: string): Promise<PortfolioData> {
  console.log(`\n🔍 Fetching on-chain data for: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`);

  const balanceData = await rpcCall('getBalance', [walletAddress]);
  const solBalance = ((balanceData.result as { value: number })?.value ?? 0) / 1e9;

  // Get SOL price from CoinGecko (no key needed)
  const priceRes = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
  );
  if (!priceRes.ok) {
    if (priceRes.status === 429) throw new Error('CoinGecko rate limit hit — wait before retrying');
    throw new Error(`CoinGecko API error: HTTP ${priceRes.status}`);
  }
  const priceData = await priceRes.json() as { solana?: { usd: number } };
  const solPrice = priceData.solana?.usd;
  if (typeof solPrice !== 'number') throw new Error('Failed to fetch SOL price from CoinGecko');

  const tokenData = await rpcCall('getTokenAccountsByOwner', [
    walletAddress,
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    { encoding: 'jsonParsed' },
  ]);
  const accounts = ((tokenData.result as { value?: unknown[] })?.value ?? []) as TokenAccount[];

  if (accounts.length > 500) {
    console.warn(`  ⚠️  Wallet has ${accounts.length} token accounts — only scanning known tokens`);
  }

  // Known token registry (common Solana tokens)
  const TOKEN_REGISTRY: Record<string, { symbol: string; coingeckoId?: string }> = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', coingeckoId: 'usd-coin' },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', coingeckoId: 'tether' },
    'So11111111111111111111111111111111111111112': { symbol: 'wSOL', coingeckoId: 'solana' },
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', coingeckoId: 'msol' },
    'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': { symbol: 'JTO', coingeckoId: 'jito-governance-token' },
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', coingeckoId: 'jupiter-exchange-solana' },
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', coingeckoId: 'bonk' },
    'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { symbol: 'PYTH', coingeckoId: 'pyth-network' },
  };

  // Aggregate holdings by mint (wallets can have multiple accounts per token)
  const holdingsByMint = new Map<string, number>();
  for (const acct of accounts) {
    const info = acct.account.data.parsed.info;
    const amount = info.tokenAmount.uiAmount ?? 0;
    if (amount > 0 && TOKEN_REGISTRY[info.mint]) {
      holdingsByMint.set(info.mint, (holdingsByMint.get(info.mint) ?? 0) + amount);
    }
  }

  // Deduplicated price IDs
  const mintsToPrice = [...new Set(
    [...holdingsByMint.keys()]
      .map(mint => TOKEN_REGISTRY[mint].coingeckoId)
      .filter((id): id is string => !!id)
  )];

  // Batch price fetch from CoinGecko
  let prices: Record<string, { usd: number }> = {};
  if (mintsToPrice.length > 0) {
    const cgRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${mintsToPrice.join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    );
    if (!cgRes.ok) {
      console.warn(`  ⚠️  CoinGecko token price fetch failed (HTTP ${cgRes.status})`);
    } else {
      prices = await cgRes.json() as Record<string, { usd: number }>;
    }
  }

  // Build token holdings with USD values
  const tokens: TokenHolding[] = [];
  for (const [mint, amount] of holdingsByMint) {
    const { symbol, coingeckoId } = TOKEN_REGISTRY[mint];
    const usdPrice = coingeckoId ? (prices[coingeckoId]?.usd ?? 0) : 0;
    tokens.push({ mint, symbol, amount, usdValue: amount * usdPrice });
  }

  // Top 10 by USD value for AI prompt (keep short), but sum all for total
  const totalTokenValue = tokens.reduce((sum, t) => sum + t.usdValue, 0);
  const topTokens = [...tokens].sort((a, b) => b.usdValue - a.usdValue).slice(0, 10);

  const solUsdValue = solBalance * solPrice;
  const totalUsdValue = solUsdValue + totalTokenValue;

  return { walletAddress, solBalance, solUsdValue, tokens: topTokens, totalUsdValue };
}

// ─── Build context string for encrypted AI analysis ──────────────────────────
function buildPortfolioContext(portfolio: PortfolioData): string {
  const tokenLines = portfolio.tokens.map(
    (t) => `  - ${t.symbol}: ${t.amount.toFixed(4)} units (~$${t.usdValue.toFixed(2)})`
  ).join('\n') || '  - (no SPL tokens found)';

  return `
Portfolio Summary:
  SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL (~$${portfolio.solUsdValue.toFixed(2)})
  SPL Tokens:
${tokenLines}
  Total Portfolio Value: ~$${portfolio.totalUsdValue.toFixed(2)} USD
`.trim();
}

// ─── Run encrypted AI risk analysis ─────────────────────────────────────────
async function analyzeWithEncryptedAI(portfolioContext: string): Promise<string> {
  // Keep prompt short — RescueCipher is O(n) so long prompts are slow
  const prompt = `DeFi risk analyst. Brief analysis of this Solana portfolio:\n${portfolioContext}\n\nProvide: 1) Risk score 1-10, 2) Top concentration/volatility risk, 3) Top 2 recommendations. Be concise.`;

  console.log('\n🔐 Encrypting query via SolRouter (your wallet details stay private)...');
  const response = await client.chat(prompt, {
    model: 'gpt-4o-mini',
    encrypted: true,
  });
  return response.message;
}

// ─── Main CLI ────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('🔒 SolRouter Private Portfolio Risk Analyzer');
  console.log('━'.repeat(50));

  if (command === 'balance') {
    const bal = await client.getBalance();
    console.log(`\n💰 SolRouter Account Balance: ${bal.balanceFormatted}`);
    return;
  }

  if (command === 'analyze') {
    const walletAddress = args[1];
    if (!walletAddress) {
      console.error('❌ Usage: analyze <wallet_address>');
      console.error('   Example: node --loader ts-node/esm src/index.ts analyze <your_solana_address>');
      process.exit(1);
    }

    // Validate Solana address using web3.js PublicKey (base58 + checksum)
    try {
      new PublicKey(walletAddress);
    } catch {
      console.error('❌ Invalid Solana address');
      process.exit(1);
    }

    try {
      // Step 1: Fetch on-chain data
      const portfolio = await fetchPortfolio(walletAddress);

      if (portfolio.totalUsdValue === 0) {
        console.log('\n📊 This wallet has no holdings.');
        return;
      }

      // Step 2: Display raw portfolio (local — no AI involved yet)
      const context = buildPortfolioContext(portfolio);
      console.log('\n📊 Portfolio Overview');
      console.log('━'.repeat(50));
      console.log(context);

      // Step 3: Encrypted AI analysis — wallet identity never sent to AI
      const analysis = await analyzeWithEncryptedAI(context);

      console.log('\n🤖 AI Risk Analysis (Processed in TEE — encrypted end-to-end)');
      console.log('━'.repeat(50));
      console.log(analysis);
      console.log('\n✅ Query processed with end-to-end encryption via SolRouter');
      console.log('   Your wallet address and portfolio data were never sent in plaintext.\n');

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Error: ${message}`);
      if (message.includes('invalid_or_expired_token')) {
        console.error('   → Check your SOLROUTER_API_KEY in .env');
      }
      process.exit(1);
    }
    return;
  }

  // Default: show help
  console.log(`
Usage:
  node --loader ts-node/esm src/index.ts analyze <wallet_address>
  node --loader ts-node/esm src/index.ts balance

Examples:
  # Analyze your portfolio privately
  node --loader ts-node/esm src/index.ts analyze 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM

  # Check SolRouter account balance
  node --loader ts-node/esm src/index.ts balance
`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
