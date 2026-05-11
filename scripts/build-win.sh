#!/bin/bash
# Cross-compile Windows installer from Linux/WSL.
# Automatically swaps better-sqlite3 native binary so Linux dev env stays usable.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

LINUX_BINARY="$PROJECT_DIR/prebuilds/better-sqlite3/linux-x64.node"
WIN_BINARY="$PROJECT_DIR/prebuilds/better-sqlite3/win32-x64.node"
TARGET="$PROJECT_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

if [ ! -f "$LINUX_BINARY" ]; then
  echo "❌ Linux better-sqlite3 binary not found at $LINUX_BINARY"
  echo "   Run: npm rebuild better-sqlite3"
  echo "   Then: cp node_modules/better-sqlite3/build/Release/better_sqlite3.node prebuilds/better-sqlite3/linux-x64.node"
  exit 1
fi

if [ ! -f "$WIN_BINARY" ]; then
  echo "❌ Windows better-sqlite3 binary not found at $WIN_BINARY"
  echo "   Run: cd node_modules/better-sqlite3 && npx prebuild-install --platform=win32 --arch=x64 --target=41.3.0 --runtime=electron --tag-prefix=v"
  echo "   Then: cp node_modules/better-sqlite3/build/Release/better_sqlite3.node prebuilds/better-sqlite3/win32-x64.node"
  exit 1
fi

echo "🔧 Swapping better-sqlite3 → Windows binary..."
cp "$WIN_BINARY" "$TARGET"

cleanup() {
  echo "🔄 Restoring better-sqlite3 → Linux binary..."
  cp "$LINUX_BINARY" "$TARGET"
}
trap cleanup EXIT

echo "📦 Building Windows installer..."
cd "$PROJECT_DIR"
bun run dist

echo "✅ Windows build complete. Linux binary restored."
