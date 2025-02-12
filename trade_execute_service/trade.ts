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

// todo: change to use websocket connection
// SOLANA_RPC_URL = 'wss://rpc.ankr.com/solana/ws/80465c767c6a5751c4cadf0778b6917d26c2d0a9ae583d3616ffaae71191a7c4'
const websocket_connection = new Connection(SOLANA_RPC_URL, {
    commitment: 'confirmed',
    wsEndpoint: 'wss://rpc.ankr.com/solana/ws/80465c767c6a5751c4cadf0778b6917d26c2d0a9ae583d3616ffaae71191a7c4'
  });

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

// Read and validate trade data
const tradeData = latestConfirmationPath ? fs.readFileSync(latestConfirmationPath, 'utf-8') : null;
if (!tradeData) {
    throw new Error('No trade data found');
}

// Get headers from first row
const headers = tradeData.split('\n')[0].split(',').map(h => h.trim());

function cleanValue(value: any): string {
    return typeof value === 'string' ? value.replace(/[\r\n]/g, '').trim() : value?.toString() || '';
}

// Parse CSV and map to TradeInfo objects
const tradeInfoList: TradeInfo[] = parse(tradeData, {
    columns: true,
    skip_empty_lines: true,
    trim: true
}).map((raw: any) => ({
    wallet_address: cleanValue(raw.wallet_address),
    coin_amount: cleanValue(raw.coin_amount),
    slippage_in_pct: cleanValue(raw.slippage_in_pct),
    from_token_address: cleanValue(raw.from_token_address),
    to_token_address: cleanValue(raw.to_token_address),
    wallet_alias: cleanValue(raw.wallet_alias),
    from_balance_before_execute: cleanValue(raw.from_balance_before_execute),
    to_balance_before_execute: cleanValue(raw.to_balance_before_execute),
    pct_of_balance: cleanValue(raw.pct_of_balance),
    delay_seconds: cleanValue(raw.delay_seconds)
}));

logAndSave(`Found ${tradeInfoList.length} trades to process`);

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

            logAndSave(`Processing trade: ${JSON.stringify(tradeInfo)}`);
            // get token decimals from csv
            const tokenDecimals = getTokenDecimals(tradeInfo.from_token_address);
            const amountInLamports = Math.floor(parseFloat(tradeInfo.coin_amount) * Math.pow(10, tokenDecimals));
            const slippageBps = Math.floor(parseFloat(tradeInfo.slippage_in_pct) * 100);

            const privateKey = walletKeysMap[tradeInfo.wallet_address];
            if (!privateKey) {
                throw new Error(`No private key found for wallet: ${tradeInfo.wallet_address}`);
            }

            logAndSave('Starting wallet initialization...');

            const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey || '')));
            logAndSave('Fetching quote from Jupiter...');
            const quoteResponse = await (
                await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${tradeInfo.from_token_address}\
&outputMint=${tradeInfo.to_token_address}\
&amount=${amountInLamports}\
&slippageBps=${slippageBps}\
&restrictIntermediateTokens=true`  //https://station.jup.ag/docs/old/apis/landing-transactions
                )
            ).json() as QuoteResponse;

            logAndSave(`Quote response: ${JSON.stringify(quoteResponse)}`);

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
            const blockhashWithExpiryBlockHeight = await websocket_connection.getLatestBlockhash('finalized');

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
                        connection: websocket_connection,
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

                        // After successful transaction
                        logAndSave(
                            `Successfully swapped ${tradeInfo.coin_amount} from ${tradeInfo.from_token_address} to ${tradeInfo.to_token_address} ` +
                            `for wallet ${tradeInfo.wallet_address}\n` +
                            `Transaction ID: ${transactionId}`,
                            TRADE_LOGS_DIR
                        );

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

            logAndSave(`Completed processing trade for wallet ${tradeInfo.wallet_address}`);
            appendToLog(
                `Completed processing trade for wallet ${tradeInfo.wallet_address} - Status: ${tradeInfo.status || 'unknown'}, TX: ${tradeInfo.transaction_id || 'none'}`, 
                TRADE_LOGS_DIR
            );
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

// Replace console.log statements with this function
function logAndSave(message: string, dir: string = TRADE_LOGS_DIR) {
    console.log(message);
    appendToLog(message, dir);
}
