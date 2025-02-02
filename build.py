# Update the wrapper script section
wrapper_script = '''#!/bin/bash
# ... previous environment setup ...

# Compile TypeScript files
echo "Compiling TypeScript files..."
"$RESOURCES_DIR/node_modules/.bin/tsc" --project "$RESOURCES_DIR/trade_execute_service/tsconfig.json" || true

# Run the app with correct ts-node configuration
cd "$SCRIPT_DIR"
"$SCRIPT_DIR/DexTraderV2" --project "$RESOURCES_DIR/trade_execute_service/tsconfig.node.json" 2>&1 | tee -a ~/Desktop/DexTraderV2_logs/launch.log
''' 