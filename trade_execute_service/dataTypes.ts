export interface TradeInfo {
    wallet_address: string;
    coin_amount: string;
    slippage_in_pct: string;
    from_token_address: string;
    to_token_address: string;
    transaction_id?: string;
    status?: string;
    [key: string]: string | undefined;
}

export interface WalletKeysMap {
    [key: string]: string;
}

export interface QuoteResponse {
    data: any;  // Add specific types if needed
}

export interface SwapResponse {
    swapTransaction: string;
}

export interface CustomError {
    message: string;
} 