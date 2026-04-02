#!/usr/bin/env node
/**
 * SolRouter Private Portfolio Risk Analyzer
 *
 * Analyzes a Solana wallet's DeFi portfolio using end-to-end encrypted
 * AI inference via SolRouter — the AI provider never sees your wallet address
 * or portfolio composition.
 */

import { SolRouter } from '@solrouter/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.SOLROUTER_API_KEY;
if (!API_KEY) {
  console.error('❌ SOLROUTER_API_KEY not set. See .env.example');
  process.exit(1);
}

const client = new SolRouter({ apiKey: API_KEY });

// ─── Helius RPC for on-chain data (free tier) ────────────────────────────────
const HELIUS_RPC = 'https://api.mainnet-beta.solana.com';

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

// ─── Fetch portfolio data from Solana RPC ────────────────────────────────────
async function fetchPortfolio(walletAddress: string): Promise<PortfolioData> {
  console.log(`\n🔍 Fetching on-chain data for: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`);

  // Get SOL balance
  const balanceRes = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [walletAddress],
    }),
  });
  const balanceData = await balanceRes.json() as { result: { value: number } };
  const solBalance = (balanceData.result?.value ?? 0) / 1e9;

  // Get SOL price from CoinGecko (no key needed)
  let solPrice = 150; // fallback
  try {
    const priceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const priceData = await priceRes.json() as { solana?: { usd: number } };
    solPrice = priceData.solana?.usd ?? solPrice;
  } catch {
    console.warn('  ⚠️  CoinGecko unavailable, using fallback SOL price $150');
  }

  // Get SPL token accounts
  const tokenRes = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'getTokenAccountsByOwner',
      params: [
        walletAddress,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' },
      ],
    }),
  });
  const tokenData = await tokenRes.json() as {
    result: {
      value: Array<{
        account: {
          data: {
            parsed: {
              info: {
                mint: string;
                tokenAmount: { uiAmount: number | null; decimals: number };
              };
            };
          };
        };
      }>;
    };
  };

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

  const tokens: TokenHolding[] = [];
  const accounts = tokenData.result?.value ?? [];

  // Only process known tokens (registry-matched) to keep prompt short
  const mintsToPrice: string[] = [];
  const rawHoldings: Array<{ mint: string; amount: number }> = [];

  for (const acct of accounts) {
    const info = acct.account.data.parsed.info;
    const amount = info.tokenAmount.uiAmount ?? 0;
    if (amount > 0 && TOKEN_REGISTRY[info.mint]) {
      rawHoldings.push({ mint: info.mint, amount });
      const known = TOKEN_REGISTRY[info.mint];
      if (known.coingeckoId) mintsToPrice.push(known.coingeckoId);
    }
  }

  // Batch price fetch from CoinGecko
  let prices: Record<string, { usd: number }> = {};
  if (mintsToPrice.length > 0) {
    try {
      const cgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${mintsToPrice.join(',')}&vs_currencies=usd`
      );
      prices = await cgRes.json() as Record<string, { usd: number }>;
    } catch {
      console.warn('  ⚠️  CoinGecko price fetch failed');
    }
  }

  for (const { mint, amount } of rawHoldings) {
    const known = TOKEN_REGISTRY[mint];
    const symbol = known.symbol;
    const cgId = known.coingeckoId;
    const usdPrice = cgId ? (prices[cgId]?.usd ?? 0) : 0;
    tokens.push({ mint, symbol, amount, usdValue: amount * usdPrice });
  }

  // Top 10 by USD value only — keeps AI prompt short
  tokens.sort((a, b) => b.usdValue - a.usdValue);
  tokens.splice(10);

  const solUsdValue = solBalance * solPrice;
  const totalUsdValue = solUsdValue + tokens.reduce((sum, t) => sum + t.usdValue, 0);

  return { walletAddress, solBalance, solUsdValue, tokens, totalUsdValue };
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

    // Validate Solana address (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
      console.error('❌ Invalid Solana address format');
      process.exit(1);
    }

    try {
      // Step 1: Fetch on-chain data
      const portfolio = await fetchPortfolio(walletAddress);

      // Step 2: Display raw portfolio (this part is local — no AI involved yet)
      console.log('\n📊 Portfolio Overview');
      console.log('━'.repeat(50));
      console.log(buildPortfolioContext(portfolio));

      // Step 3: Encrypted AI analysis — wallet identity never sent to AI
      const analysis = await analyzeWithEncryptedAI(buildPortfolioContext(portfolio));

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
