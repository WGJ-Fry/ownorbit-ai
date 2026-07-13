import Foundation
import UserNotifications

enum LifeOSEntryNotificationPolicy {
    static let expirationWarningLeadTime: TimeInterval = 24 * 60 * 60
    static let minimumScheduleDelay: TimeInterval = 60
    static let connectionFailureThreshold = 3

    static func expirationWarningDate(expiresAtMilliseconds: Int64, now: Date = Date()) -> Date? {
        guard expiresAtMilliseconds > 0 else { return nil }
        let expiration = Date(timeIntervalSince1970: TimeInterval(expiresAtMilliseconds) / 1_000)
        guard expiration.timeIntervalSince(now) > minimumScheduleDelay else { return nil }
        return max(
            now.addingTimeInterval(minimumScheduleDelay),
            expiration.addingTimeInterval(-expirationWarningLeadTime)
        )
    }

    static func shouldNotifyConnectionFailure(_ consecutiveFailureCount: Int) -> Bool {
        consecutiveFailureCount == connectionFailureThreshold
    }
}

final class LifeOSEntryNotificationCoordinator {
    private let center: UNUserNotificationCenter
    private let defaults: UserDefaults
    private let isDisabled: Bool
    private let failureCountKey = "lifeos.native.connection-failure-count.v1"
    private let expirationIdentifier = "lifeos.entry.expiring.v1"
    private let connectionIdentifier = "lifeos.entry.connection-failed.v1"

    init(
        center: UNUserNotificationCenter = .current(),
        defaults: UserDefaults = .standard,
        isDisabled: Bool = ProcessInfo.processInfo.arguments.contains("--disable-local-notifications")
            || ProcessInfo.processInfo.environment["LIFEOS_DISABLE_LOCAL_NOTIFICATIONS"] == "1"
    ) {
        self.center = center
        self.defaults = defaults
        self.isDisabled = isDisabled
    }

    func entryDidConnect(_ entry: SavedLifeOSEntry, requestAuthorization: Bool = true) {
        guard !isDisabled else { return }
        recordConnectionSuccess()
        let scheduledExpiration = scheduleExpirationWarning(for: entry, requestAuthorization: requestAuthorization)
        if requestAuthorization && !scheduledExpiration {
            requestAuthorizationIfNeeded()
        }
    }

    func recordConnectionSuccess() {
        guard !isDisabled else { return }
        defaults.set(0, forKey: failureCountKey)
        center.removePendingNotificationRequests(withIdentifiers: [connectionIdentifier])
        center.removeDeliveredNotifications(withIdentifiers: [connectionIdentifier])
    }

    func recordConnectionFailure() {
        guard !isDisabled else { return }
        let nextCount = min(100, defaults.integer(forKey: failureCountKey) + 1)
        defaults.set(nextCount, forKey: failureCountKey)
        guard LifeOSEntryNotificationPolicy.shouldNotifyConnectionFailure(nextCount) else { return }

        let content = UNMutableNotificationContent()
        content.title = NSLocalizedString("notification.connection.failed.title", comment: "")
        content.body = NSLocalizedString("notification.connection.failed.body", comment: "")
        content.sound = .default
        content.threadIdentifier = "lifeos-entry"
        content.userInfo = ["kind": "connection-failed"]
        add(
            UNNotificationRequest(
                identifier: connectionIdentifier,
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            ),
            requestAuthorization: false
        )
    }

    func clear() {
        defaults.removeObject(forKey: failureCountKey)
        let identifiers = [expirationIdentifier, connectionIdentifier]
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    @discardableResult
    private func scheduleExpirationWarning(for entry: SavedLifeOSEntry, requestAuthorization: Bool) -> Bool {
        center.removePendingNotificationRequests(withIdentifiers: [expirationIdentifier])
        guard let warningDate = LifeOSEntryNotificationPolicy.expirationWarningDate(
            expiresAtMilliseconds: entry.expiresAt
        ) else { return false }

        let content = UNMutableNotificationContent()
        content.title = NSLocalizedString("notification.entry.expiring.title", comment: "")
        content.body = NSLocalizedString("notification.entry.expiring.body", comment: "")
        content.sound = .default
        content.threadIdentifier = "lifeos-entry"
        content.userInfo = ["kind": "entry-expiring"]
        let delay = max(LifeOSEntryNotificationPolicy.minimumScheduleDelay, warningDate.timeIntervalSinceNow)
        add(
            UNNotificationRequest(
                identifier: expirationIdentifier,
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
            ),
            requestAuthorization: requestAuthorization
        )
        return true
    }

    private func requestAuthorizationIfNeeded() {
        center.getNotificationSettings { [weak self] settings in
            guard let self, settings.authorizationStatus == .notDetermined else { return }
            self.center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    private func add(_ request: UNNotificationRequest, requestAuthorization: Bool) {
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                self.center.add(request)
            case .notDetermined where requestAuthorization:
                self.center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    if granted { self.center.add(request) }
                }
            default:
                break
            }
        }
    }
}
