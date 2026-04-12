BINARY_NAME = WordsOfWorld
BUILD_DIR = .build/debug
APP_BUNDLE = $(BINARY_NAME).app
APP_CONTENTS = $(APP_BUNDLE)/Contents
ENTITLEMENTS = WordsOfWorld/WordsOfWorld.entitlements
INFO_PLIST = WordsOfWorld/Info.plist

.PHONY: build test app run clean

build:
	swift build

test:
	swift test

app: build
	rm -rf $(APP_BUNDLE)
	mkdir -p $(APP_CONTENTS)/MacOS
	mkdir -p $(APP_CONTENTS)/Resources
	cp $(BUILD_DIR)/$(BINARY_NAME) $(APP_CONTENTS)/MacOS/
	cp $(INFO_PLIST) $(APP_CONTENTS)/
	codesign --force --sign - --entitlements $(ENTITLEMENTS) $(APP_BUNDLE)
	@echo "✅ Built $(APP_BUNDLE)"

run: app
	open $(APP_BUNDLE)

clean:
	swift package clean
	rm -rf $(APP_BUNDLE)
