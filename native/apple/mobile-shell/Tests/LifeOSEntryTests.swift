import XCTest
@testable import LifeOSMobile

final class LifeOSEntryTests: XCTestCase {
    private let checksum = "85d4075524be517a3de6193c8e0392f1d0b43dde0de5b96805139426d6483ac1"

    func testJavaScriptCompatibleChecksum() throws {
        let packet = samplePacket(expiresAt: 1_900_000_000_000)
        XCTAssertEqual(LifeOSEntryValidator.checksum(for: packet), checksum)
    }

    func testChecksumMatchesRealisticUnicodeAndFallbackPacket() {
        let packet = LifeOSEntryPacket(
            kind: "lifeos-mobile-entry",
            version: 3,
            desktopId: "abc123",
            desktopName: "客厅 Mac mini",
            desktopSlug: "mac-mini-abc123",
            generatedAt: 1_783_680_000_000,
            refreshAfter: 1_783_766_400_000,
            expiresAt: 1_784_284_800_000,
            candidateId: "tailscale-https-0",
            label: "Tailscale HTTPS",
            baseUrl: "https://mac.example.ts.net/lifeos",
            mobilePairUrl: "https://mac.example.ts.net/lifeos/mobile/pair",
            mobileChatUrl: "https://mac.example.ts.net/lifeos/mobile/chat",
            mode: "tailscale",
            secure: true,
            stability: "stable",
            requiresRestart: false,
            fallbackCandidates: [LifeOSFallbackCandidate(
                id: "lan-0",
                label: "LAN Wi-Fi",
                mode: "lan",
                baseUrl: "http://192.168.1.20:3000",
                mobilePairUrl: "http://192.168.1.20:3000/mobile/pair",
                mobileChatUrl: "http://192.168.1.20:3000/mobile/chat",
                secure: false,
                stability: "local",
                requiresRestart: false,
                notes: ["仅限同一 Wi-Fi", "Do not expose publicly."]
            )],
            sameWifiOnly: false,
            transport: "icloud-handoff",
            realtimeTransport: false,
            entryChecksumSha256: "12655d4cd6e29b46ac31b19a423e00b1ee647aee4c81567e004f79421ac1861f"
        )
        XCTAssertEqual(LifeOSEntryValidator.checksum(for: packet), packet.entryChecksumSha256)
    }

    func testValidPacketBecomesSavedEntry() throws {
        let packet = samplePacket(expiresAt: 1_900_000_000_000)
        let entry = try LifeOSEntryValidator.validate(packet, now: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(entry.source, .icloud)
        XCTAssertEqual(entry.desktopName, "Demo Mac")
        XCTAssertEqual(entry.chatURL.absoluteString, "https://lifeos.example.com/mobile/chat")
        XCTAssertFalse(entry.sameWifiOnly)
    }

    func testTamperedAndExpiredPacketsAreRejected() {
        var tampered = samplePacket(expiresAt: 1_900_000_000_000)
        tampered = LifeOSEntryPacket(
            kind: tampered.kind,
            version: tampered.version,
            desktopId: tampered.desktopId,
            desktopName: "Changed Mac",
            desktopSlug: tampered.desktopSlug,
            generatedAt: tampered.generatedAt,
            refreshAfter: tampered.refreshAfter,
            expiresAt: tampered.expiresAt,
            candidateId: tampered.candidateId,
            label: tampered.label,
            baseUrl: tampered.baseUrl,
            mobilePairUrl: tampered.mobilePairUrl,
            mobileChatUrl: tampered.mobileChatUrl,
            mode: tampered.mode,
            secure: tampered.secure,
            stability: tampered.stability,
            requiresRestart: tampered.requiresRestart,
            fallbackCandidates: tampered.fallbackCandidates,
            sameWifiOnly: tampered.sameWifiOnly,
            transport: tampered.transport,
            realtimeTransport: tampered.realtimeTransport,
            entryChecksumSha256: tampered.entryChecksumSha256
        )
        XCTAssertThrowsError(try LifeOSEntryValidator.validate(tampered, now: Date(timeIntervalSince1970: 1_800_000_000))) {
            XCTAssertEqual($0 as? LifeOSEntryError, .invalidChecksum)
        }

        let expired = samplePacket(expiresAt: 1_700_000_000_000)
        XCTAssertThrowsError(try LifeOSEntryValidator.validate(expired, now: Date(timeIntervalSince1970: 1_800_000_000))) {
            XCTAssertEqual($0 as? LifeOSEntryError, .expired)
        }
    }

    func testManualURLRejectsPublicHTTPAndCredentials() {
        XCTAssertThrowsError(try LifeOSEntryValidator.manualEntry("http://example.com"))
        XCTAssertThrowsError(try LifeOSEntryValidator.manualEntry("https://user:pass@example.com"))
        XCTAssertNoThrow(try LifeOSEntryValidator.manualEntry("http://192.168.1.20:3000"))
        XCTAssertNoThrow(try LifeOSEntryValidator.manualEntry("https://lifeos.example.com/base"))
    }

    func testPacketRejectsEndpointOutsideBasePath() {
        let original = samplePacket(expiresAt: 1_900_000_000_000)
        let mismatched = LifeOSEntryPacket(
            kind: original.kind,
            version: original.version,
            desktopId: original.desktopId,
            desktopName: original.desktopName,
            desktopSlug: original.desktopSlug,
            generatedAt: original.generatedAt,
            refreshAfter: original.refreshAfter,
            expiresAt: original.expiresAt,
            candidateId: original.candidateId,
            label: original.label,
            baseUrl: original.baseUrl,
            mobilePairUrl: original.mobilePairUrl,
            mobileChatUrl: "https://lifeos.example.com/unrelated/mobile/chat",
            mode: original.mode,
            secure: original.secure,
            stability: original.stability,
            requiresRestart: original.requiresRestart,
            fallbackCandidates: original.fallbackCandidates,
            sameWifiOnly: original.sameWifiOnly,
            transport: original.transport,
            realtimeTransport: original.realtimeTransport,
            entryChecksumSha256: ""
        )
        let signedMismatch = LifeOSEntryPacket(
            kind: mismatched.kind,
            version: mismatched.version,
            desktopId: mismatched.desktopId,
            desktopName: mismatched.desktopName,
            desktopSlug: mismatched.desktopSlug,
            generatedAt: mismatched.generatedAt,
            refreshAfter: mismatched.refreshAfter,
            expiresAt: mismatched.expiresAt,
            candidateId: mismatched.candidateId,
            label: mismatched.label,
            baseUrl: mismatched.baseUrl,
            mobilePairUrl: mismatched.mobilePairUrl,
            mobileChatUrl: mismatched.mobileChatUrl,
            mode: mismatched.mode,
            secure: mismatched.secure,
            stability: mismatched.stability,
            requiresRestart: mismatched.requiresRestart,
            fallbackCandidates: mismatched.fallbackCandidates,
            sameWifiOnly: mismatched.sameWifiOnly,
            transport: mismatched.transport,
            realtimeTransport: mismatched.realtimeTransport,
            entryChecksumSha256: LifeOSEntryValidator.checksum(for: mismatched)
        )
        XCTAssertThrowsError(try LifeOSEntryValidator.validate(signedMismatch, now: Date(timeIntervalSince1970: 1_800_000_000))) {
            XCTAssertEqual($0 as? LifeOSEntryError, .mismatchedEndpoints)
        }
    }

    func testEntryNotificationPolicySchedulesOneDayBeforeExpiration() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let expiresAt = Int64(now.addingTimeInterval(3 * 24 * 60 * 60).timeIntervalSince1970 * 1_000)
        let warning = LifeOSEntryNotificationPolicy.expirationWarningDate(
            expiresAtMilliseconds: expiresAt,
            now: now
        )
        XCTAssertNotNil(warning)
        XCTAssertEqual(
            warning!.timeIntervalSince1970,
            now.addingTimeInterval(2 * 24 * 60 * 60).timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    func testEntryNotificationPolicyUsesSafeMinimumDelayAndSkipsExpiredEntry() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let soon = Int64(now.addingTimeInterval(2 * 60 * 60).timeIntervalSince1970 * 1_000)
        let warning = LifeOSEntryNotificationPolicy.expirationWarningDate(
            expiresAtMilliseconds: soon,
            now: now
        )
        XCTAssertNotNil(warning)
        XCTAssertEqual(
            warning!.timeIntervalSince1970,
            now.addingTimeInterval(LifeOSEntryNotificationPolicy.minimumScheduleDelay).timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertNil(LifeOSEntryNotificationPolicy.expirationWarningDate(
            expiresAtMilliseconds: Int64(now.addingTimeInterval(30).timeIntervalSince1970 * 1_000),
            now: now
        ))
    }

    func testEntryNotificationPolicyNotifiesOnlyAtFailureThreshold() {
        XCTAssertFalse(LifeOSEntryNotificationPolicy.shouldNotifyConnectionFailure(1))
        XCTAssertFalse(LifeOSEntryNotificationPolicy.shouldNotifyConnectionFailure(2))
        XCTAssertTrue(LifeOSEntryNotificationPolicy.shouldNotifyConnectionFailure(3))
        XCTAssertFalse(LifeOSEntryNotificationPolicy.shouldNotifyConnectionFailure(4))
    }

    private func samplePacket(expiresAt: Int64) -> LifeOSEntryPacket {
        let expectedChecksum = expiresAt == 1_700_000_000_000
            ? "3a2eb689256a278c26988b7aad9104670ef86a9f7e56839218d690ed78de9d2d"
            : checksum
        return LifeOSEntryPacket(
            kind: "lifeos-mobile-entry",
            version: 3,
            desktopId: "demo",
            desktopName: "Demo Mac",
            desktopSlug: "demo-mac",
            generatedAt: 1_780_000_000_000,
            refreshAfter: 1_780_086_400_000,
            expiresAt: expiresAt,
            candidateId: "configured-public",
            label: "Home Mac",
            baseUrl: "https://lifeos.example.com",
            mobilePairUrl: "https://lifeos.example.com/mobile/pair",
            mobileChatUrl: "https://lifeos.example.com/mobile/chat",
            mode: "configured",
            secure: true,
            stability: "stable",
            requiresRestart: false,
            fallbackCandidates: [],
            sameWifiOnly: false,
            transport: "icloud-handoff",
            realtimeTransport: false,
            entryChecksumSha256: expectedChecksum
        )
    }
}
