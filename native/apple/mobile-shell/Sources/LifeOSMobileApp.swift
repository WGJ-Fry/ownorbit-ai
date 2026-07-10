import SwiftUI
import UIKit

final class LifeOSAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        application.registerForRemoteNotifications()
        return true
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let request = LifeOSCloudKitPushRequest(completion: completionHandler)
        NotificationCenter.default.post(name: .lifeOSCloudKitPush, object: request)
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
            request.finish(.failed)
        }
    }
}

@main
struct LifeOSMobileApp: App {
    @UIApplicationDelegateAdaptor(LifeOSAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var entryStore = LifeOSEntryStore()
    @StateObject private var cloudStore = LifeOSCloudDataStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(entryStore)
                .environmentObject(cloudStore)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    Task { await entryStore.connect(deepLink: url) }
                }
                .onChange(of: scenePhase) { phase in
                    if phase == .active {
                        Task { await cloudStore.sync(reason: "foreground") }
                    }
                }
        }
    }
}
