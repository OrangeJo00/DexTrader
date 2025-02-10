import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { transactionSenderAndConfirmationWaiter } from './transactionSender';
import fetch from 'cross-fetch';
import { Wallet } from '@project-serum/anchor';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse } from 'csv-parse/sync';
import { TradeInfo, QuoteResponse, SwapResponse } from './dataTypes';
import { appendToLog, getLatestTradeConfirmation, createWalletKeysMap, writeTradeResults, exponentialBackoff } from './utils';

// Load environment variables from .env file
dotenv.config();

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
if (!SOLANA_RPC_URL) {
    throw new Error('SOLANA_RPC_URL is not defined in environment variables');
}
const connection = new Connection(SOLANA_RPC_URL);

// Get the correct base directory
const baseDir = path.join(__dirname, '..');

// Use baseDir when referencing files
const packageJsonPath = path.join(baseDir, 'package.json');
const nodeModulesPath = path.join(baseDir, 'node_modules');

// Set NODE_PATH environment variable
process.env.NODE_PATH = nodeModulesPath;
require('module').Module._initPaths(); // Refresh the module search paths

// Fix the path to be relative to the current file
const TRADE_CONF_DIR = path.join(baseDir, 'database/trade_confirmation');
const TRADE_RESULTS_DIR = path.join(baseDir, 'database/trade_results');
const TRADE_LOGS_DIR = path.join(baseDir, 'database/trade_logs');

// Add interfaces at the top
interface CustomError {
    message: string;
}

interface TokenInfo {
    token: string;
    token_decimals: number;
}

// Get latest trade confirmation sheet
const latestConfirmationPath = getLatestTradeConfirmation(TRADE_CONF_DIR);
const tradeData = latestConfirmationPath ? fs.readFileSync(latestConfirmationPath, 'utf-8') : null;

// Parse CSV data
const csvLines = tradeData?.split('\n').filter(line => line.trim()); // Remove empty lines
if (!csvLines || !csvLines[0]) {
    throw new Error('No trade data found');
}

const headers = csvLines?.[0]?.split(',');
if (!headers || csvLines.length < 2) {
    throw new Error('Invalid CSV format');
}

function getTokenDecimals(tokenAddress: string): number {
    const tokenInfoPath = path.join(__dirname, '..', 'database', 'token_info.csv');
    const fileContent = fs.readFileSync(tokenInfoPath, 'utf-8');
    const records = parse(fileContent, { columns: true }) as TokenInfo[];
    
    const tokenInfo = records.find(record => record.token === tokenAddress);
    if (!tokenInfo) {
        throw new Error(`Token ${tokenAddress} not found in token_info.csv`);
    }
    
    return parseInt(tokenInfo.token_decimals.toString());
}


// Process all lines except header into TradeInfo array
const tradeInfoList: TradeInfo[] = csvLines.slice(1).map(line => {
    const values = line.split(',');

    const rawTradeInfo = Object.fromEntries(
        headers.map((h: string, i: number) => [h, values[i]])
    );

    // Validate and create TradeInfo object
    const tradeInfo: TradeInfo = {
        wallet_address: rawTradeInfo.wallet_address,
        coin_amount: rawTradeInfo.coin_amount,
        slippage_in_pct: rawTradeInfo.slippage_in_pct,
        from_token_address: rawTradeInfo.from_token_address,
        to_token_address: rawTradeInfo.to_token_address,
        ...rawTradeInfo
    };
    return tradeInfo;
});

console.log(`Found ${tradeInfoList.length} trades to process`);

// Ensure directory exists
if (!fs.existsSync(TRADE_RESULTS_DIR)) {
    fs.mkdirSync(TRADE_RESULTS_DIR, { recursive: true });
}

// Update main function to process array of trades
async function main(tradeInfoList: TradeInfo[]): Promise<void> {
    const walletKeysMap = await createWalletKeysMap();
    for (let i = 0; i < tradeInfoList.length; i++) {
        const tradeInfo = tradeInfoList[i];
        try {
            appendToLog(`Starting to process trade ${i + 1}/${tradeInfoList.length} for wallet: ${tradeInfo.wallet_address}`, TRADE_LOGS_DIR);
            
            if (i > 0) {
                const delaySeconds = parseInt(tradeInfo.delay_seconds || '5', 10);
                if (delaySeconds > 0) {
                    // double 
                    appendToLog(`Waiting for ${delaySeconds} seconds before processing next trade...`, TRADE_LOGS_DIR);
                    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
                }
            }

            console.log("Processing trade:", tradeInfo);
            // get token decimals from csv
            const tokenDecimals = getTokenDecimals(tradeInfo.from_token_address);
            const amountInLamports = Math.floor(parseFloat(tradeInfo.coin_amount) * 10^tokenDecimals);
            const slippageBps = Math.floor(parseFloat(tradeInfo.slippage_in_pct) * 100);

            const privateKey = walletKeysMap[tradeInfo.wallet_address];
            if (!privateKey) {
                throw new Error(`No private key found for wallet: ${tradeInfo.wallet_address}`);
            }

            console.log('Starting wallet initialization...');

            const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey || '')));
            console.log('Fetching quote from Jupiter...');
            const quoteResponse = await (
                await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${tradeInfo.from_token_address}\
&outputMint=${tradeInfo.to_token_address}\
&amount=${amountInLamports}\
&slippageBps=${slippageBps}\
&restrictIntermediateTokens=true`  //https://station.jup.ag/docs/old/apis/landing-transactions
                )
            ).json() as QuoteResponse;

            console.log('Quote response:', quoteResponse);

            // get serialized transactions for the swap
            const { swapTransaction } = await (
                await fetch('https://quote-api.jup.ag/v6/swap', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        // quoteResponse from /quote api
                        quoteResponse,
                        // user public key (wallet address) to be used for the swap
                        userPublicKey: wallet.publicKey.toString(),
                        // auto wrap and unwrap SOL. default is true
                        wrapAndUnwrapSol: true,
                        // Optional, use if you want to charge a fee.  feeBps must have been passed in /quote API.
                        // feeAccount: "fee_account_public_key"
                    })
                })
            ).json() as SwapResponse;

            if (!swapTransaction) {
                throw new Error('Failed to get swap transaction from Jupiter API');
            }

            // Get fresh blockhash right before transaction
            const blockhashWithExpiryBlockHeight = await connection.getLatestBlockhash('finalized');

            // deserialize and sign the transaction
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([wallet.payer]);

            // Serialize the signed transaction
            const serializedTransaction = transaction.serialize();

            const MAX_RETRIES = 3;

            let txResponse = null;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    txResponse = await transactionSenderAndConfirmationWaiter({
                        connection,
                        serializedTransaction: Buffer.from(serializedTransaction),
                        blockhashWithExpiryBlockHeight,
                    });

                    if (txResponse) {
                        const transactionId = txResponse.transaction.signatures[0];
                        appendToLog(`Transaction successful for ${tradeInfo.wallet_address}: https://solscan.io/tx/${transactionId}`, TRADE_LOGS_DIR);

                        // Update the trade info with transaction details
                        tradeInfo.transaction_id = transactionId;
                        tradeInfo.status = 'success';

                        // Write results to file
                        writeTradeResults(tradeInfoList, headers, TRADE_RESULTS_DIR);
                        break;
                    }
                } catch (error: unknown) {
                    const err = error as CustomError;
                    appendToLog(`Attempt ${attempt}/${MAX_RETRIES} failed for ${tradeInfo.wallet_address}: ${err.message}`, TRADE_LOGS_DIR);
                    if (attempt === MAX_RETRIES) {
                        // Update status to failed after all retries are exhausted
                        tradeInfo.status = 'failed';
                        tradeInfo.transaction_id = ''; // Empty transaction ID for failed trades

                        // Write results to file
                        writeTradeResults(tradeInfoList, headers, TRADE_RESULTS_DIR);

                        throw new Error(`Transaction failed after ${MAX_RETRIES} attempts`);
                    }
                    await exponentialBackoff(attempt);
                }
            }

            if (!txResponse) {
                throw new Error('Transaction failed or expired');
            }

            console.log(`Completed processing trade for wallet ${tradeInfo.wallet_address}`);
        } catch (error: unknown) {
            const err = error as CustomError;
            appendToLog(`Failed to process trade for ${tradeInfo.wallet_address}: ${err.message}`, TRADE_LOGS_DIR);
            // Continue with next trade instead of stopping
            continue;
        } finally {
            // run update_wallet_balances after each trade
            // await update_wallet_balances(tradeInfo);
            appendToLog(`Completed processing trade for wallet ${tradeInfo.wallet_address}`, TRADE_LOGS_DIR);
        }
    }
}

// Call main with the list of trades
main(tradeInfoList).catch(error => {
    console.error('Error in main:', error);
    process.exit(1);
});

const execAsync = promisify(exec);
