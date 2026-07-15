import BackgroundTasks
import Foundation

extension Notification.Name {
    static let lifeOSCloudKitBackgroundRefresh = Notification.Name("lifeos.native.cloudkit.background-refresh")
}

final class LifeOSCloudBackgroundRefreshRequest {
    private let lock = NSLock()
    private var completed = false
    private let completion: (Bool) -> Void

    init(completion: @escaping (Bool) -> Void) {
        self.completion = completion
    }

    func finish(success: Bool) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        lock.unlock()
        completion(success)
    }
}

enum LifeOSCloudBackgroundRefreshPolicy {
    static let enabledDefaultsKey = "lifeos.native.cloud-data-enabled.v1"
    static let identifierInfoKey = "LifeOSCloudKitBackgroundRefreshIdentifier"
    static let fallbackIdentifier = "ai.lifeos.mobile.cloudkit-refresh"
    static let earliestDelay: TimeInterval = 30 * 60

    static func resolvedIdentifier(
        configuredIdentifier: String?,
        bundleIdentifier: String?
    ) -> String {
        let bundle = (bundleIdentifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = bundle.isEmpty ? fallbackIdentifier : "\(bundle).cloudkit-refresh"
        let configured = (configuredIdentifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !configured.isEmpty,
              bundle.isEmpty || configured.hasPrefix("\(bundle).") else {
            return fallback
        }
        return configured
    }

    static func identifier(bundle: Bundle = .main) -> String {
        resolvedIdentifier(
            configuredIdentifier: bundle.object(forInfoDictionaryKey: identifierInfoKey) as? String,
            bundleIdentifier: bundle.bundleIdentifier
        )
    }

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: enabledDefaultsKey)
    }
}

enum LifeOSCloudBackgroundRefreshCoordinator {
    @discardableResult
    static func register() -> Bool {
        let identifier = LifeOSCloudBackgroundRefreshPolicy.identifier()
        return BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask)
        }
    }

    @discardableResult
    static func scheduleIfEnabled(
        now: Date = Date(),
        defaults: UserDefaults = .standard
    ) -> Bool {
        let identifier = LifeOSCloudBackgroundRefreshPolicy.identifier()
        guard LifeOSCloudBackgroundRefreshPolicy.isEnabled(defaults: defaults) else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            return false
        }

        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = now.addingTimeInterval(LifeOSCloudBackgroundRefreshPolicy.earliestDelay)
        do {
            try BGTaskScheduler.shared.submit(request)
            return true
        } catch {
            return false
        }
    }

    static func cancel() {
        BGTaskScheduler.shared.cancel(
            taskRequestWithIdentifier: LifeOSCloudBackgroundRefreshPolicy.identifier()
        )
    }

    private static func handle(_ task: BGAppRefreshTask) {
        scheduleIfEnabled()
        let request = LifeOSCloudBackgroundRefreshRequest { success in
            task.setTaskCompleted(success: success)
        }
        task.expirationHandler = {
            request.finish(success: false)
        }
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .lifeOSCloudKitBackgroundRefresh,
                object: request
            )
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
            request.finish(success: false)
        }
    }
}
