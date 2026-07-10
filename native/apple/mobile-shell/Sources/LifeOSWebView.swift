import SwiftUI
import UIKit
import WebKit

struct LifeOSWebView: UIViewRepresentable {
    let entry: SavedLifeOSEntry
    let reloadToken: UUID
    @Binding var loading: Bool
    @Binding var failureMessage: String

    func makeCoordinator() -> Coordinator {
        Coordinator(entry: entry, reloadToken: reloadToken, loading: $loading, failureMessage: $failureMessage)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.024, green: 0.039, blue: 0.063, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        load(entry.handoffChatURL, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.entry = entry
        if context.coordinator.reloadToken != reloadToken {
            context.coordinator.reloadToken = reloadToken
            load(entry.handoffChatURL, in: webView)
        }
    }

    private func load(_ url: URL, in webView: WKWebView) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.cachePolicy = .reloadRevalidatingCacheData
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var entry: SavedLifeOSEntry
        var reloadToken: UUID
        private var loading: Binding<Bool>
        private var failureMessage: Binding<String>

        init(entry: SavedLifeOSEntry, reloadToken: UUID, loading: Binding<Bool>, failureMessage: Binding<String>) {
            self.entry = entry
            self.reloadToken = reloadToken
            self.loading = loading
            self.failureMessage = failureMessage
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            loading.wrappedValue = true
            failureMessage.wrappedValue = ""
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loading.wrappedValue = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.scheme == "about" || sameOrigin(url, entry.baseURL) {
                decisionHandler(.allow)
                return
            }
            if navigationAction.navigationType == .linkActivated, url.scheme == "https" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        private func fail(_ error: Error) {
            loading.wrappedValue = false
            failureMessage.wrappedValue = NSLocalizedString("browser.loadFailed", comment: "")
        }

        private func sameOrigin(_ left: URL, _ right: URL) -> Bool {
            let leftPort = left.port ?? (left.scheme == "https" ? 443 : 80)
            let rightPort = right.port ?? (right.scheme == "https" ? 443 : 80)
            return left.scheme?.lowercased() == right.scheme?.lowercased()
                && left.host?.lowercased() == right.host?.lowercased()
                && leftPort == rightPort
        }
    }
}
