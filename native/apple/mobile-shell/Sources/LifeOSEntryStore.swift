import Combine
import Foundation

@MainActor
final class LifeOSEntryStore: ObservableObject {
    enum StatusTone {
        case neutral
        case success
        case warning
        case error
    }

    @Published private(set) var entry: SavedLifeOSEntry?
    @Published private(set) var isChecking = false
    @Published private(set) var statusMessage = ""
    @Published private(set) var statusTone: StatusTone = .neutral

    private let storageKey = "lifeos.native.saved-entry.v1"

    init() {
        loadSavedEntry()
        if let rawURL = Self.launchArgument("--base-url") {
            Task { await connect(manualURL: rawURL) }
        }
    }

    func importEntry(from url: URL) async {
        isChecking = true
        defer { isChecking = false }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            let imported = try LifeOSEntryValidator.decode(data)
            try await proveLifeOS(imported)
            save(imported)
            statusMessage = imported.isStale
                ? NSLocalizedString("status.staleConnected", comment: "")
                : NSLocalizedString("status.icloudConnected", comment: "")
            statusTone = imported.isStale ? .warning : .success
        } catch let error as LifeOSEntryError {
            set(error: error)
        } catch {
            set(error: .invalidFile)
        }
    }

    func connect(manualURL: String) async {
        isChecking = true
        defer { isChecking = false }
        do {
            let manual = try LifeOSEntryValidator.manualEntry(manualURL)
            try await proveLifeOS(manual)
            save(manual)
            statusMessage = NSLocalizedString("status.manualConnected", comment: "")
            statusTone = .success
        } catch let error as LifeOSEntryError {
            set(error: error)
        } catch {
            set(error: .unavailable)
        }
    }

    func connect(deepLink url: URL) async {
        guard url.scheme?.lowercased() == "lifeos",
              url.host?.lowercased() == "connect",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let rawURL = components.queryItems?.first(where: { $0.name == "baseUrl" })?.value else {
            set(error: .unsafeURL)
            return
        }
        await connect(manualURL: rawURL)
    }

    func forgetEntry() {
        UserDefaults.standard.removeObject(forKey: storageKey)
        entry = nil
        statusMessage = NSLocalizedString("status.entryRemoved", comment: "")
        statusTone = .neutral
    }

    func recheck() async {
        guard let entry else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            try await proveLifeOS(entry)
            statusMessage = NSLocalizedString("status.connectionReady", comment: "")
            statusTone = .success
        } catch let error as LifeOSEntryError {
            set(error: error)
        } catch {
            set(error: .unavailable)
        }
    }

    private func proveLifeOS(_ entry: SavedLifeOSEntry) async throws {
        let healthURL = endpoint("api/v1/health", on: entry.baseURL)
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw LifeOSEntryError.unavailable
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              payload["service"] as? String == "lifeos-local-core" else {
            throw LifeOSEntryError.notLifeOS
        }
    }

    private func endpoint(_ path: String, on baseURL: URL) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = components.path.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        components.path = "\(basePath)/\(path)"
        components.query = nil
        components.fragment = nil
        return components.url!
    }

    private func save(_ entry: SavedLifeOSEntry) {
        if let data = try? JSONEncoder().encode(entry) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
        self.entry = entry
    }

    private func loadSavedEntry() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode(SavedLifeOSEntry.self, from: data),
              !saved.isExpired else {
            UserDefaults.standard.removeObject(forKey: storageKey)
            return
        }
        entry = saved
    }

    private func set(error: LifeOSEntryError) {
        statusMessage = error.message
        statusTone = .error
    }

    private static func launchArgument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }
}
