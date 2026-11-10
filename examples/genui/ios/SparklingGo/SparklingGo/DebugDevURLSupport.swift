// Copyright 2026 The Sparkling Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import Foundation
import Sparkling
import UIKit

#if canImport(Sparkling_DebugTool)
import Sparkling_DebugTool
#endif

enum DebugDevURLSupport {
    private static let defaultBundleSource = "./main.lynx.bundle"

    private static func fallbackBundleSource() -> String {
        return defaultBundleSource
    }

    static func mainScheme() -> String {
        #if DEBUG
        // Launched from the Mac → its dev server; from the home screen → the
        // bundled copy. The template also consults a URL saved from its dev
        // URL dialog, but on a phone that was a dead end: a launch away from
        // the Mac waited on a server it can't reach. The bundled copy works
        // anywhere, and with PLANNER_EMBED_KEY it has the LLM too.
        let source = cliDevServerURL() ?? fallbackBundleSource()
        return mainScheme(withSource: source)
        #else
        return "hybrid://lynxview_page?bundle=.%2Fmain.lynx.bundle&hide_status_bar=1&hide_nav_bar=1"
        #endif
    }

    /// The dev server `sparkling run:ios` launched us against, if any.
    ///
    /// The CLI launches the app with `SIMCTL_CHILD_SPARKLING_DEV_SERVER_HOST/PORT`,
    /// which reach this process as `SPARKLING_DEV_SERVER_HOST/PORT` — but the
    /// template's debug tool only reads a URL saved from the in-app dialog, so
    /// without this a CLI launch loads the bundled copy even with a dev server
    /// running (and the planner, built for `asset:///`, can't find its LLM
    /// proxy). A launch from the home screen has no such variables.
    private static func cliDevServerURL() -> String? {
        let env = ProcessInfo.processInfo.environment
        guard let port = env["SPARKLING_DEV_SERVER_PORT"], !port.isEmpty else { return nil }
        let host = env["SPARKLING_DEV_SERVER_HOST"].flatMap { $0.isEmpty ? nil : $0 } ?? "127.0.0.1"
        return "http://\(host):\(port)/main.lynx.bundle"
    }

    static func mainScheme(withSource source: String) -> String {
        let normalized = source.trimmingCharacters(in: .whitespacesAndNewlines)
        // Debug source accepts both remote URL and local bundle name.
        // - http(s)://... -> url=...
        // - main.lynx.bundle -> bundle=...
        if normalized.hasPrefix("http://") || normalized.hasPrefix("https://") {
            return mainScheme(withDebugURL: normalized)
        }
        let encodedBundle = normalized.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? normalized
        return "hybrid://lynxview_page?bundle=\(encodedBundle)&hide_status_bar=1&hide_nav_bar=1"
    }

    static func mainScheme(withDebugURL url: String) -> String {
        let encodedURL = url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? url
        return "hybrid://lynxview_page?url=\(encodedURL)&hide_status_bar=1&hide_nav_bar=1"
    }

    static func networkBundleURL(fromScheme scheme: String?) -> String? {
        guard let scheme, !scheme.isEmpty,
            let components = URLComponents(string: scheme),
            let urlValue = components.queryItems?.first(where: { $0.name == "url" })?.value
        else {
            return nil
        }
        let normalized = urlValue.removingPercentEncoding ?? urlValue
        guard normalized.hasPrefix("http://") || normalized.hasPrefix("https://") else {
            return nil
        }
        return normalized
    }

    static func makeContext(delegate: SPKContainerLifecycleProtocol? = nil) -> SPKContext {
        let context = SPKContext()
        context.containerLifecycleDelegate = delegate
        return context
    }

    static func storedDevURL(fallback: String) -> String {
        #if canImport(Sparkling_DebugTool)
        SparklingDebugTool.devURL(fallback: fallback)
        #else
        fallback
        #endif
    }

    static func saveDevURL(_ url: String) {
        #if canImport(Sparkling_DebugTool)
        SparklingDebugTool.setDevURL(url)
        #endif
    }

    static func showDevURLDialog(from controller: UIViewController, initialURL: String?, onSaved: @escaping (String) -> Void) {
        #if canImport(Sparkling_DebugTool)
        SparklingDebugTool.showDevURLDialog(from: controller, initialURL: initialURL, onSaved: onSaved)
        #else
        onSaved(initialURL ?? fallbackBundleSource())
        #endif
    }
}

final class DevURLLoadFailedDelegate: NSObject, SPKContainerLifecycleProtocol {
    private weak var navigationController: UINavigationController?
    private let frameProvider: () -> CGRect
    private var isPrompting = false

    init(navigationController: UINavigationController, frameProvider: @escaping () -> CGRect) {
        self.navigationController = navigationController
        self.frameProvider = frameProvider
        super.init()
    }

    func container(_ container: SPKContainerProtocol, didLoadFailedWithURL url: URL?, error: Error?) {
        #if DEBUG
        guard !isPrompting,
            let navigationController,
            let failedScheme = container.originURL?.absoluteString,
            let currentURL = DebugDevURLSupport.networkBundleURL(fromScheme: failedScheme)
        else {
            return
        }
        isPrompting = true

        DebugDevURLSupport.showDevURLDialog(from: navigationController, initialURL: currentURL) { [weak self] updatedURL in
            guard let self, let navigationController = self.navigationController else {
                return
            }
            self.isPrompting = false
            let nextScheme = DebugDevURLSupport.mainScheme(withSource: updatedURL)
            let nextContext = DebugDevURLSupport.makeContext(delegate: self)
            let nextVC = SPKRouter.create(withURL: nextScheme, context: nextContext, frame: self.frameProvider())
            navigationController.setViewControllers([nextVC], animated: false)
        }
        #endif
    }
}
