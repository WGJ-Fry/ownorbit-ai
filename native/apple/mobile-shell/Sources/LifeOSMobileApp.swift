import SwiftUI

@main
struct LifeOSMobileApp: App {
    @StateObject private var entryStore = LifeOSEntryStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(entryStore)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    Task { await entryStore.connect(deepLink: url) }
                }
        }
    }
}
