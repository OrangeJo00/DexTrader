# DexTraderV2

A decentralized trading application for Solana.

## Prerequisites

- Python 3.9+
- Node.js 16+
- npm 8+

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/DexTraderV2.git
   cd DexTraderV2
   ```

2. Copy .env.template to .env and fill in your values:
   ```bash
   cp .env.template .env
   ```
   Then edit .env with your configuration:
   - SOLANA_RPC_URL: Your Solana RPC URL
   - WALLET_KEYS: Your wallet private keys

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Install Node.js dependencies:
   ```bash
   npm install
   ```

5. Build the application:
   ```bash
   python build.py
   python prepare_dist.py
   ```

## Project Structure

- `app.py` - Main application entry point
- `trade_execute_service/` - Trading execution logic
- `wallet_service/` - Wallet management
- `calculation_service/` - Trading calculations
- `database/` - Data storage

## Development

To run in development mode:
```bash
python app.py
```

## Building

To build the distributable:
```bash
python build.py
python prepare_dist.py
```

## License

[Your chosen license]

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request