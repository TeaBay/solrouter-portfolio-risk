# SolRouter Private Portfolio Risk Analyzer 🔒

Analyze any Solana wallet's DeFi portfolio with **end-to-end encrypted AI inference** via [SolRouter](https://solrouter.com).

Your wallet address and portfolio composition are **never sent in plaintext** — the AI provider processes only encrypted blobs inside an AWS Nitro TEE (hardware-isolated enclave).

## Why Private Inference?

When you research your portfolio or a competitor's wallet, you reveal your intentions to the AI provider. With SolRouter:

- Prompt encrypted **client-side** using Arcium RescueCipher
- Routed as an encrypted blob — backend **cannot decrypt**
- Processed inside **AWS Nitro TEE** (hardware-isolated)
- Response encrypted with ephemeral key before returning

**Your research stays yours.**

## What This Tool Does

Given any Solana wallet address, it:

1. Fetches on-chain holdings via Solana RPC (SOL balance + top SPL tokens)
2. Prices tokens via CoinGecko
3. Sends portfolio summary through **SolRouter encrypted inference**
4. Returns an AI risk analysis — concentration risk, volatility risk, and recommendations

All without revealing the wallet identity or strategy to any server.

## Setup

### Prerequisites

- Node.js 18+
- A [SolRouter](https://solrouter.com) account and API key (free, no email or KYC — just connect wallet)

### Install

```bash
git clone https://github.com/TeaBay/solrouter-portfolio-risk
cd solrouter-portfolio-risk
npm install
```

### Configure

Create a `.env` file:

```
SOLROUTER_API_KEY=sk_solrouter_your_key_here
```

Get your API key at [solrouter.com](https://solrouter.com) — connect wallet, no KYC.

## Usage

### Check your SolRouter balance

```bash
node --loader ts-node/esm src/index.ts balance
```

### Analyze a wallet privately

```bash
node --loader ts-node/esm src/index.ts analyze <wallet_address>
```

### Examples

```bash
# Analyze a Solana whale wallet
node --loader ts-node/esm src/index.ts analyze 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM

# Analyze your own wallet
node --loader ts-node/esm src/index.ts analyze YOUR_WALLET_ADDRESS
```

## Example Output

```
🔒 SolRouter Private Portfolio Risk Analyzer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Fetching on-chain data for: 9WzDXwBb...AWWM

📊 Portfolio Overview
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Portfolio Summary:
  SOL Balance: 14836543.9779 SOL (~$1178021591.84)
  SPL Tokens:
  - USDT: 150000000.0000 units (~$149969700.00)
  - BONK: 6723663307555.2451 units (~$38459354.12)
  - JUP: 164970200.6200 units (~$25567246.66)
  ...
  Total Portfolio Value: ~$1411815849.27 USD

🔐 Encrypting query via SolRouter (your wallet details stay private)...

🤖 AI Risk Analysis (Processed in TEE — encrypted end-to-end)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### Portfolio Analysis

1. **Risk Score**: **7/10**
   - Heavy SOL concentration (>80%) with volatile speculative tokens.

2. **Top Concentration/Volatility Risk**:
   - SOL represents 80%+ of value — single-asset concentration risk.
   - BONK and JUP add significant volatility exposure.

3. **Top 2 Recommendations**:
   - Diversify into established assets or stablecoins.
   - Periodically rebalance volatile positions (BONK, JUP).

✅ Query processed with end-to-end encryption via SolRouter
   Your wallet address and portfolio data were never sent in plaintext.
```

## How It Works

```
You (CLI)
    │
    ├── Fetch portfolio from Solana RPC (public)
    │
    ├── @solrouter/sdk encrypts portfolio summary client-side
    │
    ▼
SolRouter Backend
    │
    ├── Cannot decrypt. Routes encrypted blob blindly (BLIND RELAY)
    │
    ▼
AWS Nitro TEE
    │
    ├── Hardware-isolated decryption
    ├── Sends plaintext to AI provider
    ├── Encrypts response with ephemeral key
    │
    ▼
You (CLI)
    │
    └── Decrypt and display risk analysis
```

## Use Cases

- Research a wallet's risk profile without revealing you're watching it
- Analyze your own DeFi positions with AI without leaking strategy
- Competitive intelligence — study any wallet anonymously
- Agent workflows where portfolio queries must remain private

## Built With

- [@solrouter/sdk](https://www.npmjs.com/package/@solrouter/sdk) — encrypted AI inference
- Solana JSON RPC — on-chain data
- CoinGecko API — token prices
- TypeScript + Node.js

## SolRouter Account

This project requires a SolRouter account. Get one free at [solrouter.com](https://solrouter.com):
1. Connect your Solana wallet
2. Get your API key
3. Add devnet USDC from [Circle Faucet](https://faucet.circle.com) (select **Solana Devnet**)

## License

MIT
