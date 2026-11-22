// Replays the device-test flows on a real iPhone. Maestro drives simulators only, so
// iphone.mjs turns flows/*.yaml into a plan of the same steps and runs this test with it,
// in the genui example's native host app (examples/genui/ios), which iphone.mjs copies
// this file into for the run. See docs/41-device-testing.md, "On a real iPhone".
//
// The plan arrives base64-encoded in FLOW_PLAN, and the server's address in FLOW_HOST,
// FLOW_PORT and FLOW_ASSETS_PORT: xcodebuild passes each TEST_RUNNER_<name> variable to
// this process as <name>.
//
// Text matches as Maestro's does: a regular expression over the whole label, or the
// label itself.

import XCTest

private struct FlowError: Error, CustomStringConvertible {
    let description: String
}

final class DeviceFlows: XCTestCase {
    private let app = XCUIApplication()
    private let environment = ProcessInfo.processInfo.environment
    private var checkedAlerts = false

    @MainActor
    func testFlows() throws {
        continueAfterFailure = true
        guard
            let encoded = environment["FLOW_PLAN"],
            let data = Data(base64Encoded: encoded),
            let flows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            XCTFail("No FLOW_PLAN: run this through packages/device-tests/iphone.mjs")
            return
        }
        var failed: [String] = []
        for flow in flows {
            let name = flow["name"] as? String ?? "?"
            let steps = flow["steps"] as? [[String: Any]] ?? []
            let started = Date()
            do {
                try run(steps)
                print("FLOW PASS \(name) \(Int(Date().timeIntervalSince(started)))s")
            } catch {
                attach("\(name)-failure")
                print("FLOW FAIL \(name): \(error)")
                failed.append(name)
            }
        }
        if !failed.isEmpty {
            XCTFail("Failed flows: \(failed.joined(separator: ", "))")
        }
    }

    // MARK: Steps

    private func run(_ steps: [[String: Any]]) throws {
        for step in steps {
            try perform(step)
        }
    }

    private func perform(_ step: [String: Any]) throws {
        let type = step["type"] as? String ?? ""
        switch type {
        case "open":
            try open(bundle: step["bundle"] as? String ?? "main", ready: step["ready"] as? String ?? "")
        case "wait":
            let timeout = seconds(step["timeout"], default: 5)
            if let text = step["visible"] as? String {
                guard waitVisible(text, timeout: timeout) != nil else {
                    throw FlowError(description: "\"\(text)\" never became visible in \(timeout)s")
                }
            } else if let text = step["notVisible"] as? String {
                guard waitGone(text, timeout: timeout) else {
                    throw FlowError(description: "\"\(text)\" was still visible after \(timeout)s")
                }
            }
        case "assertVisible":
            let text = step["text"] as? String ?? ""
            guard waitVisible(text, timeout: 7) != nil else {
                throw FlowError(description: "\"\(text)\" is not visible")
            }
        case "assertNotVisible":
            let text = step["text"] as? String ?? ""
            guard waitGone(text, timeout: 7) else {
                throw FlowError(description: "\"\(text)\" is visible")
            }
        case "tap":
            try tap(step)
        case "longPress":
            let text = step["text"] as? String ?? ""
            guard let element = waitVisible(text, timeout: 10) else {
                throw FlowError(description: "nothing to long-press: \"\(text)\"")
            }
            center(of: element).press(forDuration: 1.5)
        case "swipe":
            try swipe(step)
        case "scrollUntilVisible":
            try scrollUntilVisible(step)
        case "input":
            app.typeText(step["text"] as? String ?? "")
        case "key":
            let key = step["key"] as? String ?? ""
            guard key.lowercased() == "enter" else {
                throw FlowError(description: "unsupported key \(key)")
            }
            app.typeText("\n")
        case "screenshot":
            attach(step["name"] as? String ?? "screenshot")
        case "retry":
            let tries = (step["maxRetries"] as? Int ?? 1) + 1
            let commands = step["commands"] as? [[String: Any]] ?? []
            var lastError: Error?
            for _ in 0..<tries {
                do {
                    try run(commands)
                    return
                } catch {
                    lastError = error
                }
            }
            throw lastError ?? FlowError(description: "retry failed")
        default:
            throw FlowError(description: "unsupported step \(type)")
        }
    }

    /// Launches the host app on the server's bundle: Maestro's launchApp and openLink in one.
    private func open(bundle: String, ready: String) throws {
        guard let host = environment["FLOW_HOST"], let port = environment["FLOW_PORT"] else {
            throw FlowError(description: "no FLOW_HOST/FLOW_PORT")
        }
        let bundlePort = bundle == "main" ? port : (environment["FLOW_ASSETS_PORT"] ?? port)
        app.terminate()
        app.launchEnvironment = ["SPARKLING_DEV_SERVER_HOST": host, "SPARKLING_DEV_SERVER_PORT": bundlePort]
        app.launch()
        allowLocalNetworkOnce()
        guard waitVisible(ready, timeout: 30) != nil else {
            throw FlowError(description: "the \(bundle) bundle never showed \"\(ready)\"")
        }
    }

    /// iOS asks once whether the app may reach the local network, where the server is.
    private func allowLocalNetworkOnce() {
        guard !checkedAlerts else { return }
        checkedAlerts = true
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        if alert.waitForExistence(timeout: 3) {
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "OK"])).firstMatch
            if allow.exists { allow.tap() }
        }
    }

    private func tap(_ step: [String: Any]) throws {
        if let point = step["point"] as? String {
            coordinate(percent: point).tap()
            return
        }
        let text = step["text"] as? String ?? ""
        let optional = step["optional"] as? Bool ?? false
        guard let element = waitVisible(text, timeout: optional ? 3 : 10) else {
            if optional { return }
            throw FlowError(description: "nothing to tap: \"\(text)\"")
        }
        center(of: element).tap()
    }

    private func swipe(_ step: [String: Any]) throws {
        let direction = (step["direction"] as? String ?? "UP").uppercased()
        let duration = seconds(step["duration"], default: 0.4)
        let start: XCUICoordinate
        let end: XCUICoordinate
        if let from = step["from"] as? String {
            guard let element = waitVisible(from, timeout: 10) else {
                throw FlowError(description: "nothing to swipe from: \"\(from)\"")
            }
            start = center(of: element)
            let frame = element.frame
            let size = app.frame.size
            let target: CGPoint
            switch direction {
            case "RIGHT": target = CGPoint(x: size.width * 0.95, y: frame.midY)
            case "LEFT": target = CGPoint(x: size.width * 0.05, y: frame.midY)
            case "DOWN": target = CGPoint(x: frame.midX, y: size.height * 0.85)
            default: target = CGPoint(x: frame.midX, y: size.height * 0.15)
            }
            end = origin().withOffset(CGVector(dx: target.x, dy: target.y))
        } else {
            switch direction {
            case "RIGHT": (start, end) = (coordinate(percent: "20%,50%"), coordinate(percent: "80%,50%"))
            case "LEFT": (start, end) = (coordinate(percent: "80%,50%"), coordinate(percent: "20%,50%"))
            case "DOWN": (start, end) = (coordinate(percent: "50%,30%"), coordinate(percent: "50%,65%"))
            default: (start, end) = (coordinate(percent: "50%,65%"), coordinate(percent: "50%,30%"))
            }
        }
        drag(from: start, to: end, duration: duration)
    }

    /// Maestro's DOWN scrolls the content down, so the finger moves up.
    private func scrollUntilVisible(_ step: [String: Any]) throws {
        let text = step["element"] as? String ?? ""
        let timeout = seconds(step["timeout"], default: 20)
        let direction = (step["direction"] as? String ?? "DOWN").uppercased()
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let element = findVisible(text), app.frame.contains(element.frame) { return }
            let (from, to): (String, String)
            switch direction {
            case "UP": (from, to) = ("50%,35%", "50%,60%")
            case "LEFT": (from, to) = ("30%,50%", "70%,50%")
            case "RIGHT": (from, to) = ("70%,50%", "30%,50%")
            default: (from, to) = ("50%,60%", "50%,35%")
            }
            drag(from: coordinate(percent: from), to: coordinate(percent: to), duration: 0.6)
            Thread.sleep(forTimeInterval: 0.5)
        }
        throw FlowError(description: "scrolled \(timeout)s without reaching \"\(text)\"")
    }

    // MARK: Finding elements

    private func query(_ text: String) -> XCUIElementQuery {
        let predicate = NSPredicate(
            format: "label MATCHES %@ OR label == %@ OR identifier MATCHES %@ OR identifier == %@",
            text, text, text, text)
        return app.descendants(matching: .any).matching(predicate)
    }

    private func isOnScreen(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame
        return !frame.isEmpty && app.frame.intersects(frame)
    }

    private func findVisible(_ text: String) -> XCUIElement? {
        query(text).allElementsBoundByIndex.first(where: isOnScreen)
    }

    private func waitVisible(_ text: String, timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let element = findVisible(text) { return element }
            Thread.sleep(forTimeInterval: 0.3)
        } while Date() < deadline
        return nil
    }

    private func waitGone(_ text: String, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if findVisible(text) == nil { return true }
            Thread.sleep(forTimeInterval: 0.3)
        } while Date() < deadline
        return false
    }

    // MARK: Coordinates and gestures

    private func origin() -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    }

    private func center(of element: XCUIElement) -> XCUICoordinate {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    }

    /// "8%,8%" of the screen.
    private func coordinate(percent: String) -> XCUICoordinate {
        let parts = percent.split(separator: ",").map {
            (Double($0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "%", with: "")) ?? 50) / 100
        }
        let size = app.frame.size
        return origin().withOffset(CGVector(dx: size.width * parts[0], dy: size.height * parts[1]))
    }

    private func drag(from start: XCUICoordinate, to end: XCUICoordinate, duration: TimeInterval) {
        let dx = end.screenPoint.x - start.screenPoint.x
        let dy = end.screenPoint.y - start.screenPoint.y
        let distance = (dx * dx + dy * dy).squareRoot()
        let velocity = XCUIGestureVelocity(rawValue: max(100, distance / max(0.1, duration)))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0.1)
    }

    // MARK: Helpers

    private func seconds(_ value: Any?, default fallback: TimeInterval) -> TimeInterval {
        if let ms = value as? Double { return ms / 1000 }
        if let ms = value as? Int { return Double(ms) / 1000 }
        return fallback
    }

    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
