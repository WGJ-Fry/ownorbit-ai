import Foundation
import UIKit

enum LifeOSCloudBackgroundTrigger: String, Codable, Equatable {
    case push
    case backgroundRefresh = "background-refresh"

    init?(reason: String) {
        switch reason {
        case "push": self = .push
        case "background-refresh": self = .backgroundRefresh
        default: return nil
        }
    }

    var localizationKey: String {
        switch self {
        case .push: return "cloud.background.trigger.push"
        case .backgroundRefresh: return "cloud.background.trigger.refresh"
        }
    }
}

enum LifeOSCloudDeliveryAppState: String, Codable, Equatable {
    case active
    case inactive
    case background
    case unknown

    init(applicationState: UIApplication.State) {
        switch applicationState {
        case .active: self = .active
        case .inactive: self = .inactive
        case .background: self = .background
        @unknown default: self = .unknown
        }
    }

    var localizationKey: String {
        switch self {
        case .active: return "cloud.background.appState.active"
        case .inactive: return "cloud.background.appState.inactive"
        case .background: return "cloud.background.appState.background"
        case .unknown: return "cloud.background.appState.unknown"
        }
    }
}

extension LifeOSCloudSyncOutcome {
    var localizationKey: String {
        switch self {
        case .newData: return "cloud.background.outcome.newData"
        case .noData: return "cloud.background.outcome.noData"
        case .failed: return "cloud.background.outcome.failed"
        }
    }
}

struct LifeOSCloudBackgroundEvidence: Codable, Equatable {
    let schemaVersion: Int
    let trigger: LifeOSCloudBackgroundTrigger
    let outcome: LifeOSCloudSyncOutcome
    let recordedAt: Date
    let deliveryAppState: LifeOSCloudDeliveryAppState?

    init(
        trigger: LifeOSCloudBackgroundTrigger,
        outcome: LifeOSCloudSyncOutcome,
        recordedAt: Date = Date(),
        deliveryAppState: LifeOSCloudDeliveryAppState? = nil
    ) {
        schemaVersion = 2
        self.trigger = trigger
        self.outcome = outcome
        self.recordedAt = recordedAt
        self.deliveryAppState = deliveryAppState
    }
}

enum LifeOSCloudBackgroundEvidenceStore {
    static let defaultsKey = "ownorbit.cloudkit.background-evidence.v1"

    static func load(defaults: UserDefaults = .standard) -> LifeOSCloudBackgroundEvidence? {
        guard let data = defaults.data(forKey: defaultsKey),
              let evidence = try? JSONDecoder().decode(LifeOSCloudBackgroundEvidence.self, from: data),
              [1, 2].contains(evidence.schemaVersion) else { return nil }
        return evidence
    }

    static func save(_ evidence: LifeOSCloudBackgroundEvidence, defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(evidence) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: defaultsKey)
    }
}

enum LifeOSRemoteNotificationRegistrationState: String, Codable, Equatable {
    case registered
    case failed
}

struct LifeOSRemoteNotificationRegistrationEvidence: Codable, Equatable {
    let schemaVersion: Int
    let state: LifeOSRemoteNotificationRegistrationState
    let recordedAt: Date

    init(state: LifeOSRemoteNotificationRegistrationState, recordedAt: Date = Date()) {
        schemaVersion = 1
        self.state = state
        self.recordedAt = recordedAt
    }
}

enum LifeOSRemoteNotificationRegistrationEvidenceStore {
    static let defaultsKey = "ownorbit.cloudkit.remote-registration-evidence.v1"

    static func load(defaults: UserDefaults = .standard) -> LifeOSRemoteNotificationRegistrationEvidence? {
        guard let data = defaults.data(forKey: defaultsKey),
              let evidence = try? JSONDecoder().decode(
                LifeOSRemoteNotificationRegistrationEvidence.self,
                from: data
              ),
              evidence.schemaVersion == 1 else { return nil }
        return evidence
    }

    static func save(
        _ evidence: LifeOSRemoteNotificationRegistrationEvidence,
        defaults: UserDefaults = .standard
    ) {
        guard let data = try? JSONEncoder().encode(evidence) else { return }
        defaults.set(data, forKey: defaultsKey)
    }
}

enum LifeOSCloudBackgroundRefreshAvailability: Equatable {
    case available
    case denied
    case restricted
    case unknown

    init(status: UIBackgroundRefreshStatus) {
        switch status {
        case .available: self = .available
        case .denied: self = .denied
        case .restricted: self = .restricted
        @unknown default: self = .unknown
        }
    }

    var localizationKey: String {
        switch self {
        case .available: return "cloud.background.health.refresh.available"
        case .denied: return "cloud.background.health.refresh.denied"
        case .restricted: return "cloud.background.health.refresh.restricted"
        case .unknown: return "cloud.background.health.refresh.unknown"
        }
    }

    var isAvailable: Bool { self == .available }
}

struct LifeOSCloudBackgroundHealth: Equatable {
    let remoteNotificationsRegistered: Bool
    let registrationEvidence: LifeOSRemoteNotificationRegistrationEvidence?
    let refreshAvailability: LifeOSCloudBackgroundRefreshAvailability
    let lowPowerModeEnabled: Bool

    static let pending = LifeOSCloudBackgroundHealth(
        remoteNotificationsRegistered: false,
        registrationEvidence: nil,
        refreshAvailability: .unknown,
        lowPowerModeEnabled: false
    )

    @MainActor
    static func capture(
        application: UIApplication = .shared,
        processInfo: ProcessInfo = .processInfo,
        defaults: UserDefaults = .standard
    ) -> LifeOSCloudBackgroundHealth {
        LifeOSCloudBackgroundHealth(
            remoteNotificationsRegistered: application.isRegisteredForRemoteNotifications,
            registrationEvidence: LifeOSRemoteNotificationRegistrationEvidenceStore.load(defaults: defaults),
            refreshAvailability: LifeOSCloudBackgroundRefreshAvailability(
                status: application.backgroundRefreshStatus
            ),
            lowPowerModeEnabled: processInfo.isLowPowerModeEnabled
        )
    }

    var registrationLocalizationKey: String {
        if remoteNotificationsRegistered {
            return "cloud.background.health.push.registered"
        }
        if registrationEvidence?.state == .failed {
            return "cloud.background.health.push.failed"
        }
        return "cloud.background.health.push.pending"
    }
}
