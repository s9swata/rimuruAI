// swift-tools-version: 5.10
import PackageDescription
import Foundation

let infoPlistPath = Context.packageDirectory + "/WordsOfWorld/Info.plist"

let package = Package(
    name: "WordsOfWorld",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "WordsOfWorld",
            path: "WordsOfWorld",
            exclude: ["Info.plist", "WordsOfWorld.entitlements", "graphify-out"],
            linkerSettings: [
                .linkedFramework("Carbon"),
                .linkedFramework("UserNotifications"),
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlistPath
                ])
            ]
        ),
        .testTarget(
            name: "WordsOfWorldTests",
            dependencies: ["WordsOfWorld"],
            path: "WordsOfWorldTests",
            swiftSettings: [
                .unsafeFlags([
                    "-F", "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
                ])
            ]
        )
    ]
)
