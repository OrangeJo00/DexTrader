import * as fs from 'fs';
import * as path from 'path';

// get the latest trade_confirmation.csv file
const BASE_DIR = path.dirname(path.dirname(__dirname));
const DATABASE_DIR = path.join(BASE_DIR, 'database');
const TRADE_CONF_DIR = path.join(DATABASE_DIR, 'trade_confirmation');
const getLatestTradeConfirmation = () => {
    const files = fs.readdirSync(TRADE_CONF_DIR)
        .filter(file => file.startsWith('trade_confirmation_sheet_'))
        .sort()
        .reverse();
    
    return files[0] ? path.join(TRADE_CONF_DIR, files[0]) : null;
};

export { getLatestTradeConfirmation };


require('dotenv').config(); // Load environment variables from .env

export function createWalletKeysMap() {
    const walletKeysMap = {};

    // Loop through all environment variables
    for (const [key, value] of Object.entries(process.env)) {
        // Check if the key starts with "WALLET_KEYS_"
        console.log('key', key);
        if (key.startsWith('WALLET_KEYS_')) {
            const [publicKey, privateKey] = value.split(':'); // Split by ":"
            
            if (publicKey && privateKey) {
                walletKeysMap[publicKey] = privateKey; // Add to the map
            }
        }
    }

    console.log('walletKeysMap in utils', walletKeysMap);

    return walletKeysMap;
}

// Use the function
const walletKeysMap = createWalletKeysMap();
console.log('walletKeysMap', walletKeysMap);
export { walletKeysMap };
