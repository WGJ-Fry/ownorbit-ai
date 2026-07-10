import CryptoKit
import Foundation

struct LifeOSFallbackCandidate: Codable, Equatable {
    let id: String
    let label: String
    let mode: String
    let baseUrl: String
    let mobilePairUrl: String
    let mobileChatUrl: String
    let secure: Bool
    let stability: String
    let requiresRestart: Bool
    let notes: [String]
}

struct LifeOSEntryPacket: Codable, Equatable {
    let kind: String
    let version: Int
    let desktopId: String
    let desktopName: String
    let desktopSlug: String
    let generatedAt: Int64
    let refreshAfter: Int64
    let expiresAt: Int64
    let candidateId: String
    let label: String
    let baseUrl: String
    let mobilePairUrl: String
    let mobileChatUrl: String
    let mode: String
    let secure: Bool
    let stability: String
    let requiresRestart: Bool
    let fallbackCandidates: [LifeOSFallbackCandidate]
    let sameWifiOnly: Bool
    let transport: String
    let realtimeTransport: Bool
    let entryChecksumSha256: String
}

struct SavedLifeOSEntry: Codable, Equatable, Identifiable {
    enum Source: String, Codable {
        case icloud
        case manual
    }

    let id: String
    let source: Source
    let desktopName: String
    let baseURL: URL
    let chatURL: URL
    let pairURL: URL
    let generatedAt: Int64
    let refreshAfter: Int64
    let expiresAt: Int64
    let mode: String
    let stability: String
    let sameWifiOnly: Bool
    let checksum: String

    var isExpired: Bool {
        expiresAt > 0 && Int64(Date().timeIntervalSince1970 * 1_000) >= expiresAt
    }

    var isStale: Bool {
        refreshAfter > 0 && Int64(Date().timeIntervalSince1970 * 1_000) >= refreshAfter
    }

    var handoffChatURL: URL {
        guard source == .icloud, var components = URLComponents(url: chatURL, resolvingAgainstBaseURL: false) else {
            return chatURL
        }
        var items = components.queryItems ?? []
        items.append(contentsOf: [
            URLQueryItem(name: "lifeosEntry", value: "icloud"),
            URLQueryItem(name: "entryGeneratedAt", value: String(generatedAt)),
            URLQueryItem(name: "entryRefreshAfter", value: String(refreshAfter)),
            URLQueryItem(name: "entryExpiresAt", value: String(expiresAt)),
            URLQueryItem(name: "entryBaseUrl", value: baseURL.absoluteString),
            URLQueryItem(name: "entryMode", value: mode),
            URLQueryItem(name: "entryStability", value: stability),
            URLQueryItem(name: "entryLabel", value: desktopName),
            URLQueryItem(name: "entryDesktopId", value: id),
            URLQueryItem(name: "entryChecksumSha256", value: checksum),
        ])
        components.queryItems = items
        return components.url ?? chatURL
    }
}

enum LifeOSEntryError: Error, Equatable {
    case invalidFile
    case unsupportedVersion
    case invalidChecksum
    case expired
    case unsafeURL
    case mismatchedEndpoints
    case notLifeOS
    case unavailable

    var message: String {
        switch self {
        case .invalidFile:
            return NSLocalizedString("error.invalidFile", comment: "")
        case .unsupportedVersion:
            return NSLocalizedString("error.unsupportedVersion", comment: "")
        case .invalidChecksum:
            return NSLocalizedString("error.invalidChecksum", comment: "")
        case .expired:
            return NSLocalizedString("error.expired", comment: "")
        case .unsafeURL:
            return NSLocalizedString("error.unsafeURL", comment: "")
        case .mismatchedEndpoints:
            return NSLocalizedString("error.mismatchedEndpoints", comment: "")
        case .notLifeOS:
            return NSLocalizedString("error.notLifeOS", comment: "")
        case .unavailable:
            return NSLocalizedString("error.unavailable", comment: "")
        }
    }
}

enum LifeOSEntryValidator {
    static func decode(_ data: Data, now: Date = Date()) throws -> SavedLifeOSEntry {
        guard let packet = try? JSONDecoder().decode(LifeOSEntryPacket.self, from: data) else {
            throw LifeOSEntryError.invalidFile
        }
        return try validate(packet, now: now)
    }

    static func validate(_ packet: LifeOSEntryPacket, now: Date = Date()) throws -> SavedLifeOSEntry {
        guard packet.kind == "lifeos-mobile-entry", packet.version == 3, packet.transport == "icloud-handoff" else {
            throw LifeOSEntryError.unsupportedVersion
        }
        guard packet.entryChecksumSha256.count == 64,
              packet.entryChecksumSha256 == checksum(for: packet) else {
            throw LifeOSEntryError.invalidChecksum
        }
        let nowMilliseconds = Int64(now.timeIntervalSince1970 * 1_000)
        guard packet.expiresAt > nowMilliseconds else {
            throw LifeOSEntryError.expired
        }
        let baseURL = try normalizeBaseURL(packet.baseUrl)
        guard let chatURL = URL(string: packet.mobileChatUrl),
              let pairURL = URL(string: packet.mobilePairUrl),
              isExpectedEndpoint(chatURL, baseURL: baseURL, suffix: "mobile/chat"),
              isExpectedEndpoint(pairURL, baseURL: baseURL, suffix: "mobile/pair") else {
            throw LifeOSEntryError.mismatchedEndpoints
        }
        return SavedLifeOSEntry(
            id: packet.desktopId,
            source: .icloud,
            desktopName: packet.desktopName,
            baseURL: baseURL,
            chatURL: chatURL,
            pairURL: pairURL,
            generatedAt: packet.generatedAt,
            refreshAfter: packet.refreshAfter,
            expiresAt: packet.expiresAt,
            mode: packet.mode,
            stability: packet.stability,
            sameWifiOnly: packet.sameWifiOnly,
            checksum: packet.entryChecksumSha256
        )
    }

    static func manualEntry(_ rawURL: String) throws -> SavedLifeOSEntry {
        let baseURL = try normalizeBaseURL(rawURL)
        return SavedLifeOSEntry(
            id: "manual-\(baseURL.host ?? "entry")",
            source: .manual,
            desktopName: NSLocalizedString("entry.manualName", comment: ""),
            baseURL: baseURL,
            chatURL: append(path: "mobile/chat", to: baseURL),
            pairURL: append(path: "mobile/pair", to: baseURL),
            generatedAt: 0,
            refreshAfter: 0,
            expiresAt: 0,
            mode: "manual",
            stability: baseURL.scheme == "https" ? "stable" : "local",
            sameWifiOnly: baseURL.scheme != "https",
            checksum: ""
        )
    }

    static func normalizeBaseURL(_ rawURL: String) throws -> URL {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              scheme == "https" || (scheme == "http" && isPrivateHost(host)) else {
            throw LifeOSEntryError.unsafeURL
        }
        components.scheme = scheme
        components.host = host
        components.path = normalizedPath(components.path)
        guard let url = components.url else { throw LifeOSEntryError.unsafeURL }
        return url
    }

    static func checksum(for packet: LifeOSEntryPacket) -> String {
        let fields = [
            "\"version\":\(packet.version)",
            "\"desktopId\":\(json(packet.desktopId))",
            "\"desktopName\":\(json(packet.desktopName))",
            "\"generatedAt\":\(packet.generatedAt)",
            "\"refreshAfter\":\(packet.refreshAfter)",
            "\"expiresAt\":\(packet.expiresAt)",
            "\"candidateId\":\(json(packet.candidateId))",
            "\"baseUrl\":\(json(packet.baseUrl))",
            "\"mobilePairUrl\":\(json(packet.mobilePairUrl))",
            "\"mobileChatUrl\":\(json(packet.mobileChatUrl))",
            "\"mode\":\(json(packet.mode))",
            "\"secure\":\(packet.secure ? "true" : "false")",
            "\"stability\":\(json(packet.stability))",
            "\"requiresRestart\":\(packet.requiresRestart ? "true" : "false")",
            "\"fallbackCandidates\":[\(packet.fallbackCandidates.map(candidateJSON).joined(separator: ","))]",
            "\"sameWifiOnly\":\(packet.sameWifiOnly ? "true" : "false")",
            "\"transport\":\(json(packet.transport))",
            "\"realtimeTransport\":\(packet.realtimeTransport ? "true" : "false")",
        ]
        let data = Data("{\(fields.joined(separator: ","))}".utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func candidateJSON(_ candidate: LifeOSFallbackCandidate) -> String {
        let notes = candidate.notes.map(json).joined(separator: ",")
        return "{" + [
            "\"id\":\(json(candidate.id))",
            "\"label\":\(json(candidate.label))",
            "\"mode\":\(json(candidate.mode))",
            "\"baseUrl\":\(json(candidate.baseUrl))",
            "\"mobilePairUrl\":\(json(candidate.mobilePairUrl))",
            "\"mobileChatUrl\":\(json(candidate.mobileChatUrl))",
            "\"secure\":\(candidate.secure ? "true" : "false")",
            "\"stability\":\(json(candidate.stability))",
            "\"requiresRestart\":\(candidate.requiresRestart ? "true" : "false")",
            "\"notes\":[\(notes)]",
        ].joined(separator: ",") + "}"
    }

    private static func json(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let result = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return result
    }

    private static func sameOrigin(_ left: URL, _ right: URL) -> Bool {
        left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host?.lowercased() == right.host?.lowercased()
            && effectivePort(left) == effectivePort(right)
    }

    private static func effectivePort(_ url: URL) -> Int {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
    }

    private static func normalizedPath(_ path: String) -> String {
        let value = path.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        return value.isEmpty ? "" : (value.hasPrefix("/") ? value : "/\(value)")
    }

    private static func append(path: String, to baseURL: URL) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "\(normalizedPath(components.path))/\(path)"
        return components.url!
    }

    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" || host.hasPrefix("127.") || host == "::1" { return true }
        if host.hasPrefix("10.") || host.hasPrefix("192.168.") || host.hasPrefix("169.254.") { return true }
        if host.hasPrefix("fe80:") || host.hasPrefix("fc") || host.hasPrefix("fd") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
    }

    private static func isExpectedEndpoint(_ endpoint: URL, baseURL: URL, suffix: String) -> Bool {
        guard endpoint.user == nil,
              endpoint.password == nil,
              endpoint.query == nil,
              endpoint.fragment == nil,
              sameOrigin(baseURL, endpoint) else {
            return false
        }
        return normalizedPath(endpoint.path) == "\(normalizedPath(baseURL.path))/\(suffix)"
    }
}
