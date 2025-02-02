# DexTraderV2

A decentralized trading application for Solana, supporting automated trading with multiple wallets.

## Prerequisites

- Python 3.9+
- Node.js 16+
- npm 8+
- macOS 10.10+ (currently only supports macOS)

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/OrangeJo00/DexTrader.git
   cd DexTrader
   ```

2. Copy .env.template to .env and fill in your values:
   ```bash
   cp .env.template .env
   ```
   Then edit .env with your configuration:
   - SOLANA_RPC_URL: Your Solana RPC URL (e.g., https://api.mainnet-beta.solana.com)
   - WALLET_KEYS_[INDEX]: Your wallet keys in format "PUBLIC_KEY:PRIVATE_KEY"
   - Other configuration variables as needed

3. Install Python dependencies:
   ```bash
   # Create a virtual environment (recommended)
   python -m venv venv
   
   # Activate the virtual environment
   # On macOS/Linux:
   source venv/bin/activate
   # On Windows:
   # .\venv\Scripts\activate
   
   # Install dependencies
   pip install -r requirements.txt
   ```

4. Install Node.js dependencies:
   ```bash
   # Install TypeScript globally
   npm install -g typescript ts-node
   
   # Install project dependencies
   npm install
   ```

## Project Structure

- `app.py` - Main application entry point with GUI interface
- `trade_execute_service/` - Trading execution logic and Solana interactions
- `wallet_service/` - Wallet management and balance tracking
- `calculation_service/` - Trading calculations and strategy logic
- `database/` - Data storage for trade confirmations and results
- `node_modules/` - Node.js dependencies (generated after npm install)

## Running the Application

```bash
# Make sure virtual environment is activated
python app.py
```

## Building

To build the distributable:
```bash
python build.py
python prepare_dist.py
```

The built application will be in `DexTraderV2_Distribution_Mac_[TIMESTAMP]` directory.

## Features

- Multi-wallet trading support
- Automated trade execution
- Trade confirmation tracking
- Balance monitoring
- Solana token swaps via Jupiter
- Customizable trade parameters

## Notes

- The application creates log files in `~/Desktop/DexTraderV2_logs/`
- Trade confirmations and results are stored in the `database` directory
- Make sure to keep your .env file secure and never commit it to version control

## License

[Your chosen license]

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request