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
interface TradeInfo {
    wallet_address: string;
    coin_amount: string;
    slippage_in_pct: string;
    from_token_address: string;
    to_token_address: string;
    [key: string]: string;  // Allow other string properties
}

interface WalletKeysMap {
    [key: string]: string;
}

// Add type for Jupiter API responses
interface QuoteResponse {
    data: any;  // Add specific types if needed
}

interface SwapResponse {
    swapTransaction: string;
}

// Add this type near the top with other interfaces
interface CustomError {
    message: string;
}

// Get latest trade confirmation sheet
const getLatestTradeConfirmation = (): string | null => {
    const files = fs.readdirSync(TRADE_CONF_DIR)
        .filter((file: string) => file.startsWith('trade_confirmation_sheet_'))
        .sort()
        .reverse();

    return files[0] ? path.join(TRADE_CONF_DIR, files[0]) : null;
};

const latestConfirmationPath = getLatestTradeConfirmation();
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

const walletKeysMap = createWalletKeysMap();

// Ensure directory exists
if (!fs.existsSync(TRADE_RESULTS_DIR)) {
    fs.mkdirSync(TRADE_RESULTS_DIR, { recursive: true });
}

// Extract timestamp from confirmation sheet filename or create new one
const getTimestamp = (useConfirmationTime: boolean = true): string => {
    if (useConfirmationTime && latestConfirmationPath) {
        const filename = path.basename(latestConfirmationPath);
        const match = filename.match(/(\d{8}_\d{6})/);
        if (match) {
            return match[1];  // Returns YYYYMMDD_HHMMSS format
        }
    }
    // Fallback to current time in same format
    const now = new Date();
    return now.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .split('.')[0];
};

// Update the log file naming
function appendToLog(message: string) {
    if (!fs.existsSync(TRADE_LOGS_DIR)) {
        fs.mkdirSync(TRADE_LOGS_DIR, { recursive: true });
    }
    
    const timestamp = getTimestamp();
    const logFileName = `trade_log_${timestamp}.txt`;
    const logPath = path.join(TRADE_LOGS_DIR, logFileName);
    
    const currentTime = new Date().toISOString();
    const logEntry = `[${currentTime}] ${message}\n`;
    fs.appendFileSync(logPath, logEntry);
}

// Update main function to process array of trades
async function main(tradeInfoList: TradeInfo[]): Promise<void> {
    for (let i = 0; i < tradeInfoList.length; i++) {
        const tradeInfo = tradeInfoList[i];
        try {
            appendToLog(`Starting to process trade ${i + 1}/${tradeInfoList.length} for wallet: ${tradeInfo.wallet_address}`);
            
            if (i > 0) {
                const delaySeconds = parseInt(tradeInfo.delay_seconds || '5', 10);
                if (delaySeconds > 0) {
                    // double 
                    appendToLog(`Waiting for ${delaySeconds} seconds before processing next trade...`);
                    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
                }
            }

            console.log("Processing trade:", tradeInfo);
            const amountInLamports = Math.floor(parseFloat(tradeInfo.coin_amount) * 1e9);
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
&slippageBps=${slippageBps}`
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
            const RETRY_DELAY = 5000; // 5 seconds

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
                        appendToLog(`Transaction successful for ${tradeInfo.wallet_address}: https://solscan.io/tx/${transactionId}`);

                        // Update the trade info with transaction details
                        tradeInfo.transaction_id = transactionId;
                        tradeInfo.status = 'success';

                        // Create results file name with timestamp
                        const timestamp = getTimestamp();
                        const resultsPath = path.join(TRADE_RESULTS_DIR, `trade_results_${timestamp}.csv`);

                        // Update headers and prepare all rows
                        const updatedHeaders = [...headers, 'transaction_id', 'status'].filter((h, i, arr) => arr.indexOf(h) === i);
                        const headerRow = updatedHeaders.join(',');
                        const dataRows = tradeInfoList.map(trade =>
                            updatedHeaders.map(header => trade[header] || '').join(',')
                        );

                        // Write to new file
                        const csvContent = [headerRow, ...dataRows].join('\n');
                        fs.writeFileSync(resultsPath, csvContent);
                        console.log(`Results written to: ${resultsPath}`);
                        break;
                    }
                } catch (error: unknown) {
                    const err = error as CustomError;
                    appendToLog(`Attempt ${attempt}/${MAX_RETRIES} failed for ${tradeInfo.wallet_address}: ${err.message}`);
                    if (attempt === MAX_RETRIES) {
                        // Update status to failed after all retries are exhausted
                        tradeInfo.status = 'failed';
                        tradeInfo.transaction_id = ''; // Empty transaction ID for failed trades

                        // Create results file with failed status
                        const timestamp = getTimestamp();
                        const resultsPath = path.join(TRADE_RESULTS_DIR, `trade_results_${timestamp}.csv`);

                        const updatedHeaders = [...headers, 'transaction_id', 'status'].filter((h, i, arr) => arr.indexOf(h) === i);
                        const headerRow = updatedHeaders.join(',');
                        const dataRows = tradeInfoList.map(trade =>
                            updatedHeaders.map(header => trade[header] || '').join(',')
                        );

                        const csvContent = [headerRow, ...dataRows].join('\n');
                        fs.writeFileSync(resultsPath, csvContent);
                        console.log(`Results written to: ${resultsPath}`);

                        throw new Error(`Transaction failed after ${MAX_RETRIES} attempts`);
                    }
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                }
            }

            if (!txResponse) {
                throw new Error('Transaction failed or expired');
            }

            console.log(`Completed processing trade for wallet ${tradeInfo.wallet_address}`);
        } catch (error: unknown) {
            const err = error as CustomError;
            appendToLog(`Failed to process trade for ${tradeInfo.wallet_address}: ${err.message}`);
            // Continue with next trade instead of stopping
            continue;
        } finally {
            // run update_wallet_balances after each trade
            // await update_wallet_balances(tradeInfo);
            appendToLog(`Completed processing trade for wallet ${tradeInfo.wallet_address}`);
        }
    }
}

// Call main with the list of trades
main(tradeInfoList).catch(error => {
    console.error('Error in main:', error);
    process.exit(1);
});

function createWalletKeysMap(): WalletKeysMap {
    const walletKeysMap: WalletKeysMap = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('WALLET_KEYS_') && value) {
            const [publicKey, privateKey] = value.split(':');
            if (publicKey && privateKey) {
                walletKeysMap[publicKey] = privateKey;
            }
        }
    }
    return walletKeysMap;
}

const execAsync = promisify(exec);


// a function to update the wallet balances after each trade, import and wrapped from wallet_service/wallet_service.py
// async function update_wallet_balances(tradeInfo: TradeInfo): Promise<void> {
//     try {
//         const scriptPath = path.join(__dirname, 'update_balances.sh');
//         const { stdout, stderr } = await execAsync(
//             `${scriptPath} ${tradeInfo.wallet_address}`
//         );
//         if (stderr) {
//             console.error('Error updating wallet balances:', stderr);
//         }
//         console.log('Wallet balance update output:', stdout);
//     } catch (error) {
//         console.error('Failed to update wallet balances:', error);
//     }
// }