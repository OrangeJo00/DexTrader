import * as fs from 'fs';
import * as path from 'path';
import { GoogleSecretManager } from './googleSecretManager';
import { TradeInfo, WalletKeysMap } from './dataTypes';

export const getTimestamp = (useConfirmationTime: boolean = true, confirmationPath?: string): string => {
    if (useConfirmationTime && confirmationPath) {
        const filename = path.basename(confirmationPath);
        const match = filename.match(/(\d{8}_\d{6})/);
        if (match) {
            return match[1];
        }
    }
    
    return new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/[/:]/g, '')
        .replace(', ', '_');
};

export const appendToLog = (message: string, logsDir: string): void => {
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const timestamp = getTimestamp();
    const logFileName = `trade_log_${timestamp}.txt`;
    const logPath = path.join(logsDir, logFileName);
    
    const currentTime = new Date().toISOString();
    const logEntry = `[${currentTime}] ${message}\n`;
    fs.appendFileSync(logPath, logEntry);
};

export const getLatestTradeConfirmation = (confDir: string): string | null => {
    const files = fs.readdirSync(confDir)
        .filter((file: string) => file.startsWith('trade_confirmation_sheet_'))
        .sort()
        .reverse();

    return files[0] ? path.join(confDir, files[0]) : null;
};

export async function createWalletKeysMap(): Promise<WalletKeysMap> {
    const walletKeysMap: WalletKeysMap = {};
    
    try {
        const secretManager = new GoogleSecretManager();
        secretManager.validateEnvironment();
        const walletKeysJson = await secretManager.getSecret();
        
        for (const [key, value] of Object.entries(walletKeysJson)) {
            if (key.startsWith('WALLET_KEYS_') && value) {
                const [publicKey, privateKey] = (value as string).split(':');
                if (publicKey && privateKey) {
                    walletKeysMap[publicKey] = privateKey;
                }
            }
        }
    } catch (error) {
        console.error('Error loading wallet keys:', error);
        throw error;
    }
    
    return walletKeysMap;
}

export function writeTradeResults(
    tradeInfoList: TradeInfo[],
    headers: string[],
    resultsDir: string,
    timestamp?: string
): string {
    // Create results file name with timestamp
    const currentTimestamp = timestamp || getTimestamp();
    const resultsPath = path.join(resultsDir, `trade_results_${currentTimestamp}.csv`);

    // Update headers and prepare all rows
    const updatedHeaders = [...headers, 'transaction_id', 'status'].filter((h, i, arr) => arr.indexOf(h) === i);
    const headerRow = updatedHeaders.join(',');
    const dataRows = tradeInfoList.map(trade =>
        updatedHeaders.map(header => trade[header] || '').join(',')
    );

    // Write to file
    const csvContent = [headerRow, ...dataRows].join('\n');
    fs.writeFileSync(resultsPath, csvContent);
    console.log(`Results written to: ${resultsPath}`);
    
    return resultsPath;
}

export async function exponentialBackoff(attempt: number, baseDelay: number = 2000, maxDelay: number = 30000): Promise<void> {

    // attempt 1: 2 seconds
    // attempt 2: 4 seconds
    // attempt 3: 8 seconds
    // attempt 4: 16 seconds
    // attempt 5: 32 seconds
    // attempt 6: 64 seconds
    
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    console.log(`Retrying after ${delay}ms (attempt ${attempt + 1})...`);
    await new Promise(resolve => setTimeout(resolve, delay));
} 