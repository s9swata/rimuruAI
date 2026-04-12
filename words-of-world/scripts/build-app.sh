#!/bin/bash
set -e

APP_NAME="WordsOfWorld"
BUNDLE_ID="com.words.world"
BUILD_DIR=".build/release"
SOURCE_DIR="WordsOfWorld"
OUTPUT_DIR="dist"

echo "Building $APP_NAME..."

# Build release binary
swift build -c release

# Create .app bundle structure
rm -rf "$OUTPUT_DIR/$APP_NAME.app"
mkdir -p "$OUTPUT_DIR/$APP_NAME.app/Contents/MacOS"
mkdir -p "$OUTPUT_DIR/$APP_NAME.app/Contents/Resources"

# Copy binary
cp "$BUILD_DIR/$APP_NAME" "$OUTPUT_DIR/$APP_NAME.app/Contents/MacOS/"

# Copy Info.plist
cp "$SOURCE_DIR/Info.plist" "$OUTPUT_DIR/$APP_NAME.app/Contents/"

# Copy entitlements if exists
if [ -f "$SOURCE_DIR/WordsOfWorld.entitlements" ]; then
    cp "$SOURCE_DIR/WordsOfWorld.entitlements" "$OUTPUT_DIR/$APP_NAME.app/Contents/"
fi

echo "Built: $OUTPUT_DIR/$APP_NAME.app"

# Copy to Applications (requires admin)
if [ "$1" = "--install" ]; then
    echo "Installing to /Applications..."
    cp -R "$OUTPUT_DIR/$APP_NAME.app" /Applications/
    echo "Installed! Open from /Applications/$APP_NAME.app"
fi