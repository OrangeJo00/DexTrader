import httpx
import asyncio
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
# SOLANA_MAINNET_URL = os.getenv('SOLANA_MAINNET_URL')
SOLANA_URL = os.getenv('SOLANA_RPC_URL')

class Wallet:
    def __init__(self, 
                 address,
                 url: str = SOLANA_URL,
                 max_retries: int = 3,
                 backoff_factor: int = 2):
        """
        Initialize a Wallet instance.
        
        Args:
            address (str): Solana wallet address
            url (str): RPC endpoint URL
            max_retries (int): Maximum number of retry attempts
            backoff_factor (int): Factor for exponential backoff
        """
        self.address = address
        self.url = url
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor

        if not self.url:
            raise ValueError("RPC URL not found in environment variables")

    async def _make_request(self, method: str, params: list) -> dict:
        """
        Makes a request to the Solana RPC endpoint with retry and backoff.

        Args:
            method (str): The RPC method to call
            params (list): Parameters for the RPC call

        Returns:
            dict: The JSON response from the RPC endpoint

        Raises:
            httpx.HTTPStatusError: If the request fails after all retries
        """
        headers = {"Content-Type": "application/json"}
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        }

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        self.url,
                        json=payload,
                        headers=headers
                    )
                    response.raise_for_status()
                    return response.json()

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:  # Rate limit error
                    retry_after = int(e.response.headers.get("Retry-After", 1))
                    wait_time = self.backoff_factor ** attempt + retry_after
                    print(f"Rate limited. Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    raise e

        raise httpx.HTTPStatusError(
            f"Exceeded maximum retries for {method}",
            request=None,
            response=None
        )

    async def get_balance(self) -> float:
        """
        Get the balance of the wallet in SOL.

        Returns:
            float: Balance in lamports

        Raises:
            Exception: If there's an error getting the balance
        """
        try:
            response_data = await self._make_request('getBalance', [self.address])
            
            if "error" in response_data:
                raise Exception(f"RPC Error: {response_data['error']}")
                
            balance = response_data["result"]["value"]
            sol_balance = balance / 10 ** 9
            return round(sol_balance,6)

        except Exception as e:
            print(f"Error getting balance: {e}")
            raise

    async def get_token_balance(self, mint_address) -> dict:
        """
        Get balance for a specific token mint address.

        Args:
            mint_address (str): The mint address of the token (defaults to USDC)

        Returns:
            dict: Token account information including balance
        """
        retries = 3
        for attempt in range(retries):
            try:
                params = [
                    self.address,
                    {"mint": mint_address},
                    {"encoding": "jsonParsed"}
                ]
                
                response = await self._make_request("getTokenAccountsByOwner", params)
                
                if "error" in response:
                    raise Exception(f"RPC Error: {response['error']}")
                
                accounts = response["result"]["value"]
                if not accounts:
                    return {"balance": 0, "decimals": 0, "uiAmount": 0}

                # Get the first account (there should typically be only one per mint)
                account = accounts[0]
                token_data = account["account"]["data"]["parsed"]["info"]
                
                return {
                    "mint_address": mint_address,
                    "balance": token_data["tokenAmount"]["amount"],
                    "decimals": token_data["tokenAmount"]["decimals"],
                    "uiAmount": token_data["tokenAmount"]["uiAmount"], # already default 6 decimals
                    "uiAmountString": token_data["tokenAmount"]["uiAmountString"]
                }

            except Exception as e:
                if attempt < retries - 1:  # Don't sleep on the last attempt
                    print(f"Attempt {attempt + 1} failed, retrying in 5 seconds... Error: {e}")
                    await asyncio.sleep(5)
                else:
                    print(f"Error getting token balance after {retries} attempts: {e}")
                    raise
