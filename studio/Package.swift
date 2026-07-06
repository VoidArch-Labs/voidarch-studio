// swift-tools-version:6.0
// Voidarch Studio — hybrid SwiftUI shell (spec: docs/mvp/nox-memory-and-studio-mvp-v2.md).
// Build/run: swift run VoidarchStudio   (macOS 14+, Apple Silicon primary)
import PackageDescription

let package = Package(
    name: "VoidarchStudio",
    platforms: [.macOS(.v14)],
    dependencies: [
        // Integrated terminal (PTY view) — MVP panel per spec §5.
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.2.0"),
    ],
    targets: [
        .executableTarget(
            name: "VoidarchStudio",
            dependencies: ["SwiftTerm"],
            path: "Sources/VoidarchStudio"
        ),
    ]
)
