// Copyright (c) 2026 TikTok Pte. Ltd.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import Foundation
import Lynx
import UIKit
#if canImport(Sparkling_DebugTool)
import Sparkling_DebugTool
#endif

/// Wires the Sparkling debug tool into the app lifecycle. Only active when
/// the DebugTool pod is linked (i.e. debug builds). The debug tool itself
/// auto-installs the JS console sink, GlobalProps provider, Sparkling Method
/// observer, and floating-ball tap action — the host only needs to flip the
/// floating ball on.
enum DebugConsoleSupport {
    /// The blue "sparkling" tag (bottom-left) opens the inspector — JS console,
    /// GlobalProps, Sparkling Method calls. The template always shows it in
    /// debug builds; it sits over the planner's UI, so it's opt-in here:
    /// launch with `SPARKLING_DEBUG_TAG=1` in the environment, e.g.
    /// `SIMCTL_CHILD_SPARKLING_DEBUG_TAG=1 xcrun simctl launch booted dev.angularlynx.planner`.
    /// Release builds don't link the debug tool at all.
    static func setup() {
        #if canImport(Sparkling_DebugTool)
        let showTag = ProcessInfo.processInfo.environment["SPARKLING_DEBUG_TAG"] == "1"
        SparklingDebugTool.setFloatingBallEnabled(showTag)
        #endif
    }

    static func presentConsole(from presenter: UIViewController) {
        #if canImport(Sparkling_DebugTool)
        SparklingDebugTool.presentConsolePanel(from: presenter)
        #else
        let alert = UIAlertController(
            title: "JS Console",
            message: "DebugTool is not available in this build.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
        #endif
    }
}

/// Lets a test drive host-data pushes on the real engine, which Lynx Explorer
/// can't: `updateData` with and without a processor name, a reset, and global
/// props. Debug builds only, and only when launched with
/// `ANGULAR_LYNX_HOST_DATA_HOOKS=1`. Each push is a Darwin notification:
///
///   xcrun simctl spawn booted notifyutil -p dev.angularlynx.hostdata.named
///
/// See docs/17-host-data.md. The page is packages/device-tests.
enum HostDataTestHooks {
    private static let prefix = "dev.angularlynx.hostdata."

    /// Each notification's push, applied to the LynxView on screen.
    private static let pushes: [String: (LynxView) -> Void] = [
        "plain": { $0.updateData(with: ["mockData": "Pushed by the host"]) },
        "named": { $0.updateData(with: ["note": "Native note"], processorName: "fromNative") },
        "reset": { $0.resetData(with: LynxTemplateData(dictionary: ["mockData": "Reset by the host"])) },
        "globalprops": { $0.updateGlobalProps(with: ["hostNote": "Set by the host"]) },
    ]

    static func setup() {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["ANGULAR_LYNX_HOST_DATA_HOOKS"] == "1" else { return }
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        for name in pushes.keys {
            CFNotificationCenterAddObserver(
                center, nil,
                { _, _, cfName, _, _ in
                    guard let full = cfName?.rawValue as String? else { return }
                    DispatchQueue.main.async { HostDataTestHooks.apply(String(full.dropFirst(HostDataTestHooks.prefix.count))) }
                },
                (prefix + name) as CFString, nil, .deliverImmediately)
        }
        NSLog("[HostDataTestHooks] listening for %@*", prefix)
        #endif
    }

    private static func apply(_ name: String) {
        guard let push = pushes[name] else { return }
        let roots = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows }.flatMap { $0 }
        guard let view = roots.lazy.compactMap({ findLynxView(in: $0) }).first else {
            NSLog("[HostDataTestHooks] %@: no LynxView on screen", name)
            return
        }
        push(view)
        NSLog("[HostDataTestHooks] pushed %@", name)
    }

    private static func findLynxView(in view: UIView) -> LynxView? {
        if let lynx = view as? LynxView { return lynx }
        for child in view.subviews {
            if let found = findLynxView(in: child) { return found }
        }
        return nil
    }
}
